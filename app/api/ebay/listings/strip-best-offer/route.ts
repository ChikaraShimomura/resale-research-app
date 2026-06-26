import { getActorId } from "../../../../lib/auth/actor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getOfferForSku, disableBestOfferForOffer } from "../../../../lib/ebay/listing";
import { getListingSku, listDealsForUser } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";

// 既存の出品中の商品から「値下げ交渉（Best Offer）」を一括で外す移行アクション（ユーザー指示2026-06-27）。
// 自分（このactor）の出品中(live)のオファーを順に見て、bestOfferTerms があれば外す。冪等（無ければ何もしない）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const skuFor = async (actor: string, productId: string): Promise<string> =>
  (await getListingSku(actor, productId)) ?? skuForProduct(productId);

export async function POST() {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const { live } = await listDealsForUser(actor);
  let checked = 0;
  let changed = 0;
  let failed = 0;
  // 一回の操作上限（暴走防止）。出品上限があるので通常は十分。
  for (const d of live.slice(0, 200)) {
    const offer = await getOfferForSku(token, await skuFor(actor, d.id));
    if (!offer) continue;
    checked++;
    const r = await disableBestOfferForOffer(token, offer.offerId);
    if (!r.ok) failed++;
    else if (r.changed) changed++;
  }
  return Response.json({ ok: true, checked, changed, failed });
}
