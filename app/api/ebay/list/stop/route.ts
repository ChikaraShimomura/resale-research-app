import { kv } from "@vercel/kv";
import { getActorId } from "../../../../lib/auth/actor";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { withdrawListingForSku, SKU_MAP_KEY } from "../../../../lib/ebay/listing";
import { getListingSku } from "../../../../lib/ebay/stats";
import { skuForProduct } from "../../../../lib/ebay/sellApi";

// 「出品停止」: eBayの出品(オファー)を取り下げて終了し、出品中一覧から外す。
// オファーは残す＝あとで再出品できる。Dealの記録(仕入れ額等)は保持し、検索には再表示される。
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

  // 出品中一覧から外す＝SKU対応表のエントリを削除（isPublished=false になり一覧から消え、検索に再表示）。
  // Deal の記録（仕入れ額・出品日）は残す＝再出品時に引き継げる。
  try {
    await kv.hdel(SKU_MAP_KEY(actor), sku);
    const legacy = skuForProduct(body.productId);
    if (legacy !== sku) await kv.hdel(SKU_MAP_KEY(actor), legacy);
  } catch {
    /* noop */
  }
  return Response.json({ ok: true, ended: r.ended });
}
