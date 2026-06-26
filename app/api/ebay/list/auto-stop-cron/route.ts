import { kv } from "@vercel/kv";
import { reconcileActorStops } from "../../../../lib/ebay/sourceReconcile";
import { pruneExpiredStops } from "../../../../lib/ebay/stats";
import { notifyShipDue, recordOrders } from "../../../../lib/ebay/orders";
import { getValidAccessToken, loadTokens } from "../../../../lib/ebay/tokens";
import { getSoldItems } from "../../../../lib/ebay/sellApi";

// cron用：全アクターを走査し、仕入れ元が売切/リンク切れの出品をeBayから自動停止する。
// 検知(checkListings.mjs)が deal.sourceStatus を立てた直後に、check-listings ワークフローから呼ばれる。
// 離席中でも~30分以内に自動停止＝欠品キャンセル防止。CRON_SECRET で保護。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  // 認証：Authorization: Bearer <CRON_SECRET> か ?secret=。未設定なら拒否(フェイルクローズ)。
  // 全アクターの出品を取り下げる破壊的cronなので、設定漏れ時に無認可で動かさない。
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization");
  if (!secret || (bearer !== `Bearer ${secret}` && url.searchParams.get("secret") !== secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 対象アクター = ebay_deals:* ∪ ebay_orders:*（出品を全部やめた/自動削除された後も未発送注文が残る
  // アクターを取りこぼさない＝発送期限通知の漏れ防止。注文は deal と独立キーで貯まるため）。
  const actorSet = new Set<string>();
  for (const prefix of ["ebay_deals:", "ebay_orders:"]) {
    let cursor = "0";
    let guard = 0;
    do {
      const res: [string | number, string[]] = await kv.scan(cursor, { match: `${prefix}*`, count: 200 });
      cursor = String(res[0]);
      for (const k of res[1]) actorSet.add(String(k).slice(prefix.length));
    } while (cursor !== "0" && ++guard < 1000);
  }
  const actors = [...actorSet];

  // 箱価格(複数タイプ)で原価誤認＝不採算の商品ID集合を1回だけ取得し、各アクターで使い回す
  // （refresh が catalog_overpriced_ids に全置換で書く。出品中があれば下で自動停止＝「除外時はeBay停止も」）。
  let overpricedIds = new Set<string>();
  try {
    const arr = await kv.get<string[]>("catalog_overpriced_ids");
    overpricedIds = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    /* 取得失敗時は空集合＝overpriced停止はスキップ（dead/soldoutは従来どおり効く） */
  }

  let totalStopped = 0;
  let totalArchived = 0;
  let totalDueNotified = 0;
  let totalOrdersIngested = 0;
  for (const actor of actors) {
    try {
      const s = await reconcileActorStops(actor, overpricedIds);
      totalStopped += s.length;
    } catch {
      /* 1アクターの失敗で全体を止めない */
    }
    try {
      // 出品停止中に入って24時間を過ぎた取引を自動アーカイブ＝「過去の出品」へ移す（離席中でも掃除）。完全削除はしない（archivedAt付与＋2年TTLでレコード保持）。
      const archived = await pruneExpiredStops(actor);
      totalArchived += archived.length;
    } catch {
      /* アーカイブ失敗は次回リトライ */
    }
    try {
      // 注文(Order)の取り込み＝サーバー側で実行（従来はクライアントの /api/ebay/sold 起動のみ）。
      // これが無いと、離席中のユーザーには新規注文がKVに入らず ③発送期限通知が一度も発火しない。
      // 連携あり＆sell.fulfillment 付きトークンのアクターだけ eBay を叩く（無トークン/旧スコープは即skip）。
      const stored = await loadTokens(actor);
      if (stored?.scopes?.includes("sell.fulfillment")) {
        const token = await getValidAccessToken(actor);
        if (token) {
          const res = await getSoldItems(token);
          if (!res.needsReconnect && res.orders.length > 0) {
            await recordOrders(actor, res.orders);
            totalOrdersIngested += res.orders.length;
          }
        }
      }
    } catch {
      /* 取込失敗は次回リトライ（notifyShipDue は既存の保存分で動く） */
    }
    try {
      // ③ 発送期限が近い/過ぎた未発送注文を本人へ通知（1注文1日1回）。上の取込で新規注文も対象になる。
      totalDueNotified += await notifyShipDue(actor);
    } catch {
      /* 通知失敗は次回リトライ */
    }
  }
  return Response.json({ ok: true, actors: actors.length, stopped: totalStopped, pruned: totalArchived, ordersIngested: totalOrdersIngested, dueNotified: totalDueNotified });
}
