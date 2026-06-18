import { getActorId } from "../../../../lib/auth/actor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { withdrawListingForSku } from "../../../../lib/ebay/listing";
import { getListingSku, markStopped } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";

// 「出品停止」: eBayの出品(オファー)を取り下げて終了し、「出品停止中一覧」へ移す。
// オファーは残す＝あとで再出品できる。Dealの記録(仕入れ額等)も保持。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as { productId?: string };
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const sku = (await getListingSku(actor, body.productId)) ?? skuForProduct(body.productId);
  const r = await withdrawListingForSku(token, sku);
  if (!r.ok) return Response.json({ ok: false, error: r.error || "出品停止に失敗しました。" });

  // 出品停止中一覧へ移す（dealに停止フラグ stoppedAt を付与。dealが無ければ何もしない）。
  // 記録は保持＝再出品で復帰できる。停止中は検索一覧にも出さない（listListedProductIdsがstoppedを含む）。
  await markStopped(actor, body.productId);
  return Response.json({ ok: true, ended: r.ended });
}
