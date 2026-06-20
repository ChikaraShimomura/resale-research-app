import { getActorId } from "../../../lib/auth/actor";
import { listOrders } from "../../../lib/ebay/orders";

// 発送タブ表示用：保存済みの注文(ebay_orders)を新しい順で返す（eBayは叩かない・高速）。
// 中身は sold 同期(POST /api/ebay/sold)が getOrders から貯める。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActorId();
  if (!actor) return Response.json({ orders: [], connected: false });
  const orders = await listOrders(actor);
  return Response.json(
    { orders, connected: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
