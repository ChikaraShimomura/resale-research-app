import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { kvReadOnly } from "../../../../lib/kv";
import { ProfitProduct } from "../../../../lib/profitFilter";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { createAndPublish, SKU_MAP_KEY } from "../../../../lib/ebay/listing";
import { skuForProduct } from "../../../../lib/ebay/sellApi";

// 「eBay出品する」：在庫アイテム→オファー→公開を実行し、SKU→商品ID の対応表を保存する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Payload {
  productId?: string;
  title?: string;
  priceUsd?: string;
  condition?: string;
  categoryId?: string;
  aspects?: Record<string, string>; // { Brand: "Unbranded", ... }
}

async function getProduct(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    return products?.find((p) => p.id === id) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const body = (await req.json().catch(() => ({}))) as Payload;
  if (!body.productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });
  if (!body.categoryId) return Response.json({ ok: false, error: "カテゴリが未指定です。" }, { status: 400 });
  if (!body.priceUsd || Number(body.priceUsd) <= 0) {
    return Response.json({ ok: false, error: "価格(USD)を入力してください。" }, { status: 400 });
  }

  const product = await getProduct(body.productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  const title = (body.title || product.title).slice(0, 80);
  // 必須項目（空値は送らない）。値は配列で渡す。
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(body.aspects ?? {})) {
    if (v && v.trim()) aspects[k] = [v.trim()];
  }

  const description = `${title}\n\nBrand new item shipped directly from Japan with tracking. Carefully packaged. Please check the photo.`;

  const result = await createAndPublish(token, {
    productId: product.id,
    title,
    description,
    imageUrl: product.imageUrl,
    priceUsd: Number(body.priceUsd).toFixed(2),
    condition: body.condition || (product.isNew === false ? "USED_EXCELLENT" : "NEW"),
    categoryId: body.categoryId,
    aspects,
  });

  // 公開できたら SKU→商品ID を保存（売却検知の逆引き用）
  if (result.ok) {
    try {
      await kv.hset(SKU_MAP_KEY(actor), { [skuForProduct(product.id)]: product.id });
      await kv.expire(SKU_MAP_KEY(actor), 180 * 24 * 60 * 60);
    } catch {
      /* noop */
    }
  }

  return Response.json(result);
}
