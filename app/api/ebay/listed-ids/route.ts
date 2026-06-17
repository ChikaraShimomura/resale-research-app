import { getActorId } from "../../../lib/auth/actor";
import { listListedProductIds } from "../../../lib/ebay/stats";

// 検索一覧で「本人が出品/販売済みの商品」を隠す（出品中一覧へ"移す"）ための軽量GET。
// ebay_deals の全キーだけを返す。ログイン時は actor=acct:{uuid} なのでアカウント単位＝別端末でも同じ。
// eBay もカタログも叩かない（KVハッシュ1回）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, ids: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const ids = await listListedProductIds(actor);
  return Response.json({ ok: true, ids }, { headers: { "Cache-Control": "private, no-store" } });
}
