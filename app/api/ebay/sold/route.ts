import { kv } from "@vercel/kv";
import { getTeamContext } from "../../../lib/auth/teamActor";
import { getValidAccessToken, loadTokens } from "../../../lib/ebay/tokens";
import { getSoldItems } from "../../../lib/ebay/sellApi";
import { SKU_MAP_KEY, SKU_MAP_TTL } from "../../../lib/ebay/listing";
import { recordSold } from "../../../lib/ebay/stats";
import { recordOrders } from "../../../lib/ebay/orders";
import { sendToActor } from "../../../lib/push";
import { FUNNEL_TTL, jstDate, evcKey, evuKey } from "../../../lib/funnel";

// 「自分がeBayで売れた商品」の自動検知。
// アプリ出品は SKU="rr-{サニタイズ済み商品ID}"。getOrders から売れた注文の SKU を読み、
// 出品時に保存した対応表(SKU→商品ID)で逆引きして、商品IDを端末(アクター)単位の KV セットに蓄積する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOLD_KEY = (actor: string) => `ebay_sold:${actor}`;
const TTL_SECONDS = 180 * 24 * 60 * 60; // 最終更新から180日で自動リセット

async function storedIds(actor: string): Promise<string[]> {
  try {
    return (await kv.smembers(SOLD_KEY(actor))) ?? [];
  } catch {
    return [];
  }
}

// GET: 保存済みの「売れた商品ID」を返す（eBayは叩かない・高速）。表示側が毎回呼ぶ。
// チーム共有：売れた商品の集合は共有名前空間(dataActor=オーナー)で全員に見せる。
export async function GET() {
  const { dataActor } = await getTeamContext();
  if (!dataActor) return Response.json({ ids: [], connected: false });
  return Response.json(
    { ids: await storedIds(dataActor), connected: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

// POST: eBay getOrders で同期 → セットへ追加 → 最新の全IDを返す。
// eBay同期は出品アカウント(ebayActor)、検知結果(売却記録/売れた集合/注文)は共有名前空間(dataActor)へ。
export async function POST() {
  const { viewer, dataActor, ebayActor } = await getTeamContext();
  if (!ebayActor || !dataActor) return Response.json({ ids: [], connected: false });

  const stored = await loadTokens(ebayActor);
  if (!stored) return Response.json({ ids: await storedIds(dataActor), connected: false });

  // 旧トークンは sell.fulfillment 未付与 → eBayを叩かず再連携を促す
  if (!stored.scopes?.includes("sell.fulfillment")) {
    return Response.json({ ids: await storedIds(dataActor), connected: true, needsReconnect: true });
  }

  const token = await getValidAccessToken(ebayActor);
  if (!token) return Response.json({ ids: await storedIds(dataActor), connected: false });

  const res = await getSoldItems(token);
  if (res.needsReconnect) {
    return Response.json({ ids: await storedIds(dataActor), connected: true, needsReconnect: true });
  }

  // 売れた SKU → 商品ID（出品時に保存した対応表で逆引き）。あわせて売値を記録（ダッシュボード用）。
  // partial（途中でeBayエラー）でも、拾えた分は取りこぼさず保存する。
  const productIds: string[] = [];
  if (res.items.length > 0) {
    try {
      const map = (await kv.hgetall<Record<string, string>>(SKU_MAP_KEY(ebayActor))) ?? {};
      // 同期のたびに逆引き表のTTLを再延長（活動があれば実質失効させない）
      if (Object.keys(map).length > 0) {
        try {
          await kv.expire(SKU_MAP_KEY(ebayActor), SKU_MAP_TTL);
        } catch {
          /* noop */
        }
      }
      for (const it of res.items) {
        const pid = map[it.sku];
        if (!pid) continue;
        productIds.push(pid);
        await recordSold(dataActor, pid, it.soldUsd, it.soldAt);
      }
    } catch {
      /* noop */
    }
  }

  // 注文(Order)エンティティを保存（買い手住所/発送期限/orderId/lineItem/状態）＝配送管理の土台。
  // 売却検知(productIds)とは独立に、アプリ出品ラインを含む注文を毎回 upsert する。共有名前空間へ。
  if (res.orders.length > 0) {
    await recordOrders(dataActor, res.orders);
  }

  if (productIds.length > 0) {
    try {
      // sadd は member を1つ以上要求するため先頭を別引数で渡す（length>0 を確認済み）。
      // 戻り値＝新規に追加された件数（＝今回はじめて検知した売却）。共有名前空間の「売れた集合」へ。
      const added = await kv.sadd(SOLD_KEY(dataActor), productIds[0], ...productIds.slice(1));
      await kv.expire(SOLD_KEY(dataActor), TTL_SECONDS);
      // ファネル計測：新規検知分だけ「売れた」を加算（ポーリングでの二重計上を防ぐ）。
      if (added > 0) {
        const date = jstDate();
        await Promise.all([
          kv.incrby(evcKey(date, "sold"), added),
          kv.expire(evcKey(date, "sold"), FUNNEL_TTL),
          kv.sadd(evuKey(date, "sold"), dataActor),
          kv.expire(evuKey(date, "sold"), FUNNEL_TTL),
        ]);
        // 新規に検知した売却を同期した本人へプッシュ通知（「売れたとき」をONにしている購読のみ）。VAPID未設定なら無視。
        await sendToActor(viewer ?? dataActor, "sold", {
          title: "🎉 売れたかも！",
          body: `${added}件の出品が売れた可能性があります。マイページで確認しましょう。`,
          url: "/mypage",
          tag: "sold",
        });
      }
    } catch {
      /* noop */
    }
  }
  // partial の時は全件を読み切れていない＝同期未完了。synced:false を返し、
  // クライアント側の30分ゲートを進めず次回も同期させる（売却の取りこぼし防止）。
  return Response.json({
    ids: await storedIds(dataActor),
    connected: true,
    needsReconnect: false,
    synced: !res.partial,
  });
}
