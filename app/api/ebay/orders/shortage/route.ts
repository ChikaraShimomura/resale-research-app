import { getActorId } from "../../../../lib/auth/actor";
import { markShortage } from "../../../../lib/ebay/orders";

// ⑤ 欠品（仕入れ元で仕入れ不可）として記録。eBayの自動キャンセルは別scope(Post-Order API)が必要で未対応のため、
// ここでは「欠品対応中」フラグを立てるだけ＝発送タブで買い手連絡＋eBayキャンセル画面への導線を出す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  const body = (await req.json().catch(() => ({}))) as { orderId?: string };
  const orderId = (body.orderId || "").trim();
  if (!orderId) return Response.json({ ok: false, error: "注文IDが必要です。" }, { status: 400 });
  await markShortage(actor, orderId);
  return Response.json({ ok: true });
}
