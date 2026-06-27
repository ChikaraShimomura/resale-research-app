import { getDataActor } from "../../../lib/auth/teamActor";
import { listOrders } from "../../../lib/ebay/orders";

// 発送タブ表示用：保存済みの注文(ebay_orders)を新しい順で返す（eBayは叩かない・高速）。
// 中身は sold 同期(POST /api/ebay/sold)が getOrders から貯める。チーム共有名前空間で全員が同じ発送一覧を見る。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getDataActor();
  if (!actor) return Response.json({ orders: [], connected: false });
  const orders = await listOrders(actor);
  return Response.json(
    { orders, connected: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
