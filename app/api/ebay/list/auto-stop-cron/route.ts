import { kv } from "@vercel/kv";
import { reconcileActorStops } from "../../../../lib/ebay/sourceReconcile";
import { pruneExpiredStops } from "../../../../lib/ebay/stats";
import { notifyShipDue } from "../../../../lib/ebay/orders";

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

  let totalStopped = 0;
  let totalPruned = 0;
  let totalDueNotified = 0;
  for (const actor of actors) {
    try {
      const s = await reconcileActorStops(actor);
      totalStopped += s.length;
    } catch {
      /* 1アクターの失敗で全体を止めない */
    }
    try {
      // 出品停止中に入って24時間を過ぎた取引を自動削除（離席中でも掃除）。
      const pruned = await pruneExpiredStops(actor);
      totalPruned += pruned.length;
    } catch {
      /* 削除失敗は次回リトライ */
    }
    try {
      // ③ 発送期限が近い/過ぎた未発送注文を本人へ通知（1注文1日1回）。
      totalDueNotified += await notifyShipDue(actor);
    } catch {
      /* 通知失敗は次回リトライ */
    }
  }
  return Response.json({ ok: true, actors: actors.length, stopped: totalStopped, pruned: totalPruned, dueNotified: totalDueNotified });
}
