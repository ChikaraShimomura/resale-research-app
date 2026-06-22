import { getProductById } from "../../../lib/ebay/productStore";
import { canViewCatalog } from "../../../lib/auth/plan";

// 単一商品の取得（現行カタログ → 出品アーカイブ psnap のフォールバック付き）。
// マイページの「出品」「再出品」が、利益商品カタログから入れ替わりで外れた商品でもモーダルを開けるようにする。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 利益商品データ(楽天仕入URL/仕入値/利益率/eBay照合URL等)は購読者(＋身内/管理者)限定。
  // /api/products と同じ canViewCatalog ゲートを掛け、未購読/未ログインにはデータを渡さない（ID列挙による課金回避を防ぐ）。
  // PAYWALL_ENABLED が OFF の間は canViewCatalog が常に true＝既存挙動のまま。
  if (!(await canViewCatalog())) {
    return Response.json(
      { ok: false, product: null, needsPlan: true },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const product = await getProductById(id);
  if (!product) return Response.json({ ok: false, product: null }, { status: 404 });
  return Response.json({ ok: true, product }, { headers: { "Cache-Control": "private, no-store" } });
}
