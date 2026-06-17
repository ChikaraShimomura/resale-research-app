// 「仕入れ中の商品」＝「楽天で仕入れる」を押したが、まだeBayに出品していない商品。
// 端末(アクター)単位の KV ハッシュ ebay_sourcing:{actor} に蓄積する。ログイン時は actor=acct:{uuid} なので
// アカウントに紐づき別端末でも同じ仕入れ中が出る。表示用の値(商品名/画像/仕入れ値)はスナップショット保存し、
// 利益商品カタログから外れても一覧の表示が欠けないようにする（出品中/販売した一覧と同じ方針）。
import { kv } from "@vercel/kv";

const SOURCING_KEY = (actor: string) => `ebay_sourcing:${actor}`;
const TTL_SECONDS = 730 * 24 * 60 * 60; // ebay_deals と揃える（2年保持・操作の都度 expire を再延長）

export interface SourcingItem {
  title: string;
  imageUrl?: string;
  purchase: number; // 楽天仕入れ(送料込・JPY)。表示用スナップショット
  points: number;
  addedAt: string;
  purchased?: boolean; // 「仕入れた」を押した＝購入済み・出品待ち
}

export interface SourcingView {
  id: string;
  title: string;
  imageUrl: string;
  purchase: number;
  purchased: boolean;
  addedAt: string;
}

// 「楽天で仕入れる」押下時：仕入れ中として記録。既存があれば壊さない（購入済み印・スナップショットを維持）。
export async function recordSourcing(
  actor: string,
  productId: string,
  d: { title: string; imageUrl?: string; purchase: number; points: number; addedAt: string }
): Promise<void> {
  try {
    const existing = await kv.hget<SourcingItem>(SOURCING_KEY(actor), productId);
    if (!existing) await kv.hset(SOURCING_KEY(actor), { [productId]: { ...d } });
    await kv.expire(SOURCING_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 「仕入れた」：購入済み（出品待ち）の印を付ける。一覧には残す。
export async function markPurchased(actor: string, productId: string): Promise<void> {
  try {
    const existing = await kv.hget<SourcingItem>(SOURCING_KEY(actor), productId);
    if (!existing || existing.purchased) return;
    await kv.hset(SOURCING_KEY(actor), { [productId]: { ...existing, purchased: true } });
    await kv.expire(SOURCING_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 「やめた」/ 出品成功：仕入れ中から外す。
export async function removeSourcing(actor: string, productId: string): Promise<void> {
  try {
    await kv.hdel(SOURCING_KEY(actor), productId);
  } catch {
    /* noop */
  }
}

// 仕入れ中一覧（新しい順）。出品済み(deals)に入ったものの除外は呼び出し側で行う。
export async function listSourcingForUser(actor: string): Promise<SourcingView[]> {
  let items: Record<string, SourcingItem> = {};
  try {
    items = (await kv.hgetall<Record<string, SourcingItem>>(SOURCING_KEY(actor))) ?? {};
  } catch {
    return [];
  }
  return Object.entries(items)
    .map(([id, d]) => ({
      id,
      title: d.title || "",
      imageUrl: d.imageUrl || "",
      purchase: d.purchase ?? 0,
      purchased: !!d.purchased,
      addedAt: d.addedAt || "",
    }))
    .sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));
}
