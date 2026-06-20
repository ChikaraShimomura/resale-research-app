import { getActorId } from "../../../../lib/auth/actor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { createShippingFulfillment } from "../../../../lib/ebay/sellApi";
import { markOrderShipped } from "../../../../lib/ebay/orders";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";

// ② 追跡番号の登録：eBayへ書き戻し(createShippingFulfillment)し、成功したら注文(Order)へ記録する。
// 発送タブの入力欄から POST { orderId, trackingNumber, carrier } で呼ぶ想定。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    trackingNumber?: string;
    carrier?: string;
  };
  const orderId = (body.orderId || "").trim();
  const trackingNumber = (body.trackingNumber || "").trim();
  if (!orderId || !trackingNumber) {
    return Response.json({ ok: false, error: "注文IDと追跡番号を入力してください。" }, { status: 400 });
  }

  const res = await createShippingFulfillment(token, orderId, { trackingNumber, carrier: body.carrier });
  if (!res.ok) {
    const f = friendlyEbayError(res.error, res.status);
    return Response.json({ ok: false, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: res.error });
  }
  await markOrderShipped(actor, orderId, { trackingNumber, carrier: body.carrier });
  return Response.json({ ok: true });
}
