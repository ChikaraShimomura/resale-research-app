import { kv } from "@vercel/kv";
import type { EbayOrder } from "./sellApi";

// 注文(Order)エンティティの保存先＝配送管理の土台。
// sold 同期(getSoldItems)が拾った正規化注文を orderId 単位で upsert する。
// 追跡番号の書き戻し(②)・発送期限カウントダウン(③)・欠品リカバリ(⑤)・発送待ちビューが全部これを読む。
const ORDERS_KEY = (actor: string) => `ebay_orders:${actor}`;
const TTL_SECONDS = 180 * 24 * 60 * 60; // 最終更新から180日で自動リセット（ebay_sold と揃える）

// アプリが後から付与するフィールド（eBayの再同期で消さないよう upsert でマージ保持する）。
export interface OrderAppFields {
  trackingNumber?: string; // ② 追跡番号（eBay書き戻し済みか）
  carrier?: string;
  shippedAt?: string; // 発送通知を出した時刻
  note?: string; // 運営メモ
  shortageHandledAt?: string; // ⑤ 欠品リカバリ対応済み
}
export type StoredOrder = EbayOrder & OrderAppFields;

// eBay 由来の最新注文を upsert。既存の手動フィールド(trackingNumber 等)は温存し、eBay側の鮮度（状態/期限）を反映。
export async function recordOrders(actor: string, orders: EbayOrder[]): Promise<void> {
  if (!orders.length) return;
  try {
    const existing = (await kv.hgetall<Record<string, StoredOrder>>(ORDERS_KEY(actor))) ?? {};
    const patch: Record<string, StoredOrder> = {};
    for (const o of orders) {
      if (!o.orderId) continue;
      const prev = existing[o.orderId];
      // eBay の最新(o)を上書き適用。prev のアプリ追加フィールドは o に無いので維持される。
      patch[o.orderId] = prev ? { ...prev, ...o } : o;
    }
    if (Object.keys(patch).length > 0) {
      await kv.hset(ORDERS_KEY(actor), patch);
      await kv.expire(ORDERS_KEY(actor), TTL_SECONDS);
    }
  } catch {
    /* noop: 保存失敗は売却検知本体を妨げない */
  }
}

// ② 追跡番号を注文に記録（eBay書き戻し createShippingFulfillment が成功した後に呼ぶ）。
export async function markOrderShipped(
  actor: string,
  orderId: string,
  fields: { trackingNumber: string; carrier?: string }
): Promise<void> {
  try {
    const prev = await kv.hget<StoredOrder>(ORDERS_KEY(actor), orderId);
    if (!prev) return;
    await kv.hset(ORDERS_KEY(actor), {
      [orderId]: { ...prev, trackingNumber: fields.trackingNumber, carrier: fields.carrier, shippedAt: new Date().toISOString() },
    });
    await kv.expire(ORDERS_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 保存済み注文を新しい順(注文日降順)で返す。発送待ちビュー等の表示側が使う。
export async function listOrders(actor: string): Promise<StoredOrder[]> {
  try {
    const all = (await kv.hgetall<Record<string, StoredOrder>>(ORDERS_KEY(actor))) ?? {};
    return Object.values(all).sort((a, b) => (b.creationDate ?? "").localeCompare(a.creationDate ?? ""));
  } catch {
    return [];
  }
}
