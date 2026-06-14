import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { getValidAccessToken, loadTokens } from "../../../lib/ebay/tokens";
import { getSoldItems } from "../../../lib/ebay/sellApi";
import { SKU_MAP_KEY, SKU_MAP_TTL } from "../../../lib/ebay/listing";
import { recordSold } from "../../../lib/ebay/stats";
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
export async function GET() {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ids: [], connected: false });
  return Response.json(
    { ids: await storedIds(actor), connected: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

// POST: eBay getOrders で同期 → セットへ追加 → 最新の全IDを返す。
export async function POST() {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ids: [], connected: false });

  const stored = await loadTokens(actor);
  if (!stored) return Response.json({ ids: [], connected: false });

  // 旧トークンは sell.fulfillment 未付与 → eBayを叩かず再連携を促す
  if (!stored.scopes?.includes("sell.fulfillment")) {
    return Response.json({ ids: await storedIds(actor), connected: true, needsReconnect: true });
  }

  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ids: [], connected: false });

  const res = await getSoldItems(token);
  if (res.needsReconnect) {
    return Response.json({ ids: await storedIds(actor), connected: true, needsReconnect: true });
  }

  // 売れた SKU → 商品ID（出品時に保存した対応表で逆引き）。あわせて売値を記録（ダッシュボード用）。
  // partial（途中でeBayエラー）でも、拾えた分は取りこぼさず保存する。
  const productIds: string[] = [];
  if (res.items.length > 0) {
    try {
      const map = (await kv.hgetall<Record<string, string>>(SKU_MAP_KEY(actor))) ?? {};
      // 同期のたびに逆引き表のTTLを再延長（活動があれば実質失効させない）
      if (Object.keys(map).length > 0) {
        try {
          await kv.expire(SKU_MAP_KEY(actor), SKU_MAP_TTL);
        } catch {
          /* noop */
        }
      }
      for (const it of res.items) {
        const pid = map[it.sku];
        if (!pid) continue;
        productIds.push(pid);
        await recordSold(actor, pid, it.soldUsd, it.soldAt);
      }
    } catch {
      /* noop */
    }
  }

  if (productIds.length > 0) {
    try {
      // sadd は member を1つ以上要求するため先頭を別引数で渡す（length>0 を確認済み）。
      // 戻り値＝新規に追加された件数（＝今回はじめて検知した売却）。
      const added = await kv.sadd(SOLD_KEY(actor), productIds[0], ...productIds.slice(1));
      await kv.expire(SOLD_KEY(actor), TTL_SECONDS);
      // ファネル計測：新規検知分だけ「売れた」を加算（ポーリングでの二重計上を防ぐ）。
      if (added > 0) {
        const date = jstDate();
        await Promise.all([
          kv.incrby(evcKey(date, "sold"), added),
          kv.expire(evcKey(date, "sold"), FUNNEL_TTL),
          kv.sadd(evuKey(date, "sold"), actor),
          kv.expire(evuKey(date, "sold"), FUNNEL_TTL),
        ]);
      }
    } catch {
      /* noop */
    }
  }
  // partial の時は全件を読み切れていない＝同期未完了。synced:false を返し、
  // クライアント側の30分ゲートを進めず次回も同期させる（売却の取りこぼし防止）。
  return Response.json({
    ids: await storedIds(actor),
    connected: true,
    needsReconnect: false,
    synced: !res.partial,
  });
}
