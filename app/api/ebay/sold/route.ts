import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { getValidAccessToken, loadTokens } from "../../../lib/ebay/tokens";
import { getSoldProductIds } from "../../../lib/ebay/sellApi";

// 「自分がeBayで売れた商品」の自動検知。
// アプリ経由でeBay出品した商品は SKU="rr-{商品ID}"。getOrders から売れた注文を読み、
// その商品IDを端末(アクター)単位で KV のセットに蓄積する。表示側はこのセットで非表示/最下部化する。
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

  const res = await getSoldProductIds(token);
  if (res.needsReconnect) {
    return Response.json({ ids: await storedIds(actor), connected: true, needsReconnect: true });
  }

  if (res.ids.length > 0) {
    try {
      // sadd は member を1つ以上要求するため先頭を別引数で渡す（length>0 を確認済み）
      await kv.sadd(SOLD_KEY(actor), res.ids[0], ...res.ids.slice(1));
      await kv.expire(SOLD_KEY(actor), TTL_SECONDS);
    } catch {
      /* noop */
    }
  }
  return Response.json({ ids: await storedIds(actor), connected: true, needsReconnect: false, synced: true });
}
