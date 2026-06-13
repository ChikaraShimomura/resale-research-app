import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { kvReadOnly } from "../../../../lib/kv";
import { ProfitProduct } from "../../../../lib/profitFilter";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { createAndPublish, SKU_MAP_KEY } from "../../../../lib/ebay/listing";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import { recordListed } from "../../../../lib/ebay/stats";
import { SOLD_THRESHOLD } from "../../../../lib/sold";

// 「eBay出品する」：在庫アイテム→オファー→公開を実行し、SKU→商品ID の対応表を保存する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Payload {
  productId?: string;
  title?: string;
  description?: string;
  priceUsd?: string;
  condition?: string;
  categoryId?: string;
  aspects?: Record<string, string>; // { Brand: "Unbranded", ... }
  fulfillmentPolicyId?: string; // 選んだ送料サイズ
  handlingDays?: number; // 発送までの日数（落札後）
  quantity?: number; // 出品個数（在庫数）。1〜30
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
  const price = Number(body.priceUsd);
  if (!body.priceUsd || !Number.isFinite(price) || price < 0.01) {
    return Response.json({ ok: false, error: "価格(USD)を入力してください。" }, { status: 400 });
  }

  const product = await getProduct(body.productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  const title = (body.title || product.coreKeyword || product.title).slice(0, 80);
  // 必須項目（空値は送らない）。値は配列で渡す。
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(body.aspects ?? {})) {
    if (v && v.trim()) aspects[k] = [v.trim()];
  }

  const description =
    (body.description && body.description.trim()) ||
    `${title}\n\nShipped directly from Japan with tracking. Carefully packaged. Please check the photo.`;

  const result = await createAndPublish(token, {
    productId: product.id,
    title,
    description,
    imageUrl: product.imageUrl,
    priceUsd: price.toFixed(2),
    condition: body.condition || "NEW",
    categoryId: body.categoryId,
    aspects,
    fulfillmentPolicyId: body.fulfillmentPolicyId,
    handlingDays: Number(body.handlingDays) > 0 ? Number(body.handlingDays) : undefined,
    quantity: Number(body.quantity) > 0 ? Number(body.quantity) : 1,
  });

  // 出品（下書き含む＝オファー作成）できたら、出品者数を計上（SOLD判定の元・乱立防止）。
  // 1端末は何度出しても +0（SADDで冪等）。押下数ではなく実出品数で数える。
  if (result.offerId) {
    try {
      await kv.sadd(`listing_actors:${product.id}`, actor);
      await kv.expire(`listing_actors:${product.id}`, 90 * 24 * 60 * 60);
      // 出品者数が飽和しきい値(SOLD_THRESHOLD)に達してSOLD化した瞬間を記録。30日後に refresh が
      // DBから削除＋カウントリセットし、再び新しい利益商品として検知できるようにする。
      if ((await kv.scard(`listing_actors:${product.id}`)) >= SOLD_THRESHOLD) {
        if ((await kv.hget("sold_since", product.id)) == null) {
          await kv.hset("sold_since", { [product.id]: Date.now() });
        }
      }
    } catch {
      /* noop */
    }
    // 下書き/本人確認待ちでも「出品着手」を記録（育てるダッシュボード・オンボーディング判定用）
    await recordListed(actor, product.id, {
      purchase: product.source.price,
      points: product.source.pointAmount ?? 0,
      title: product.title,
      listedAt: new Date().toISOString(),
    });
  }

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
