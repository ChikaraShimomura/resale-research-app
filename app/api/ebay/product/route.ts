import { getProductById } from "../../../lib/ebay/productStore";

// 単一商品の取得（現行カタログ → 出品アーカイブ psnap のフォールバック付き）。
// マイページの「出品」「再出品」が、利益商品カタログから入れ替わりで外れた商品でもモーダルを開けるようにする。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const product = await getProductById(id);
  if (!product) return Response.json({ ok: false, product: null }, { status: 404 });
  return Response.json({ ok: true, product }, { headers: { "Cache-Control": "private, no-store" } });
}
