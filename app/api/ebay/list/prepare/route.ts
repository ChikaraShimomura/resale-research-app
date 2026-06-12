import { cookies } from "next/headers";
import { kvReadOnly } from "../../../../lib/kv";
import { ProfitProduct } from "../../../../lib/profitFilter";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getAppAccessToken } from "../../../../lib/ebay/oauth";
import {
  getCategorySuggestion,
  getRequiredAspects,
  USD_JPY,
  RequiredAspect,
} from "../../../../lib/ebay/listing";

// 「eBay出品画面」の確認用データを返す（読み取りのみ・eBayへの書き込みなし）。
// 楽天画像・タイトル・推奨USD価格・自動判定カテゴリ・必須Item Specifics を返す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getProduct(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    return products?.find((p) => p.id === id) ?? null;
  } catch {
    return null;
  }
}

// 必須Item Specifics の初期値（Brandは Unbranded、選択式は先頭候補、それ以外は空）
function defaultAspect(a: RequiredAspect): string {
  if (/brand/i.test(a.name)) return "Unbranded";
  if (!a.free && a.values.length > 0) return a.values[0];
  return "";
}

export async function POST(req: Request) {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const { productId } = (await req.json().catch(() => ({}))) as { productId?: string };
  if (!productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const product = await getProduct(productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  const priceUsd = Math.max(1, Math.round((product.realAvgPrice / USD_JPY) * 100) / 100).toFixed(2);

  // カテゴリ + 必須Item Specifics（Taxonomy）。アプリトークン優先、不可ならユーザートークン。
  const query = product.coreKeyword || product.title;
  const taxoToken = (await getAppAccessToken()) || token;
  const cat = await getCategorySuggestion(taxoToken, query);

  let requiredAspects: { name: string; values: string[]; free: boolean; value: string }[] = [];
  if (cat?.categoryId) {
    const aspects = await getRequiredAspects(taxoToken, cat.categoryTreeId, cat.categoryId);
    requiredAspects = aspects.map((a) => ({ ...a, value: defaultAspect(a) }));
  }

  return Response.json(
    {
      ok: true,
      product: {
        id: product.id,
        title: product.title,
        imageUrl: product.imageUrl,
        rakutenPrice: product.source.price,
        ebayAvgJpy: product.realAvgPrice,
      },
      priceUsd,
      condition: product.isNew === false ? "USED_EXCELLENT" : "NEW",
      category: cat
        ? { categoryId: cat.categoryId, categoryName: cat.categoryName, categoryTreeId: cat.categoryTreeId }
        : null,
      requiredAspects,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
