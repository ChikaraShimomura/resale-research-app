import { kv } from "@vercel/kv";
import type { EbayOrder } from "./sellApi";
import { sendToActor } from "../push";
import { jstDate } from "../funnel";

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
  dueNotifiedDate?: string; // ③ 発送期限プッシュを送った日(JST)。1注文1日1回に制限。
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

// 発送済み（追跡番号登録済み or eBayでFULFILLED）か。
function isShippedStored(o: StoredOrder): boolean {
  return !!o.trackingNumber || o.fulfillmentStatus === "FULFILLED";
}

// ③ 発送期限が近い(残り1日以内)/過ぎた未発送注文を本人へプッシュ通知。1注文につき1日1回。
// auto-stop-cron(全アクター走査)から呼ぶ＝新cron不要。push基盤(sendToActor)の"sold"カテゴリで送る。
// 通知件数を返す。注文データは sold 同期で貯まった ebay_orders を読むだけ（eBayは叩かない）。
export async function notifyShipDue(actor: string): Promise<number> {
  try {
    const all = (await kv.hgetall<Record<string, StoredOrder>>(ORDERS_KEY(actor))) ?? {};
    const today = jstDate();
    const now = Date.now();
    const due: StoredOrder[] = [];
    for (const o of Object.values(all)) {
      if (!o || o.cancelled || o.shortageHandledAt || isShippedStored(o) || !o.shipByDate) continue;
      const t = new Date(o.shipByDate).getTime();
      if (Number.isNaN(t)) continue;
      const days = Math.ceil((t - now) / 86400000);
      if (days > 1) continue; // 期限まで2日以上ある＝まだ通知しない
      if (o.dueNotifiedDate === today) continue; // 今日はもう送った
      due.push(o);
    }
    if (due.length === 0) return 0;
    await sendToActor(actor, "sold", {
      title: "📦 発送期限が近い注文",
      body: `${due.length}件の発送期限が近い/過ぎています。発送タブで追跡番号を登録しましょう。`,
      url: "/ship",
      tag: "ship_due",
    });
    // 送った注文に今日の日付を刻む（同日中の重複送信を防ぐ）。
    const patch: Record<string, StoredOrder> = {};
    for (const o of due) patch[o.orderId] = { ...o, dueNotifiedDate: today };
    await kv.hset(ORDERS_KEY(actor), patch);
    await kv.expire(ORDERS_KEY(actor), TTL_SECONDS);
    return due.length;
  } catch {
    return 0;
  }
}

// ⑤ 欠品（仕入れ元で仕入れ不可）として記録。発送タブで「欠品対応中」に切替＝買い手連絡＋eBayキャンセルの導線用。
export async function markShortage(actor: string, orderId: string): Promise<void> {
  try {
    const prev = await kv.hget<StoredOrder>(ORDERS_KEY(actor), orderId);
    if (!prev) return;
    await kv.hset(ORDERS_KEY(actor), { [orderId]: { ...prev, shortageHandledAt: new Date().toISOString() } });
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
