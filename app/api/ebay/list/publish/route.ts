import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { getActorId } from "../../../../lib/auth/actor";
import { kvReadOnly } from "../../../../lib/kv";
import { ProfitProduct } from "../../../../lib/profitFilter";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { createAndPublish, SKU_MAP_KEY, SKU_MAP_TTL } from "../../../../lib/ebay/listing";
import { filterProductImages } from "../../../../lib/ebay/imageFilter";
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
  bestOffer?: boolean; // 値下げ交渉(Best Offer)を受け付けるか（既定ON）
  floorUsd?: number | string; // 損益分岐USD（自動拒否ラインに使う）
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
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, connected: false });
  // listing_actors（乱立防止のSOLD集計）は端末単位を維持。利益台帳/トークン/SKU対応表はアカウント単位(actor)。
  const did = (await cookies()).get("rr_did")?.value ?? actor;
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

  // 複数画像: 楽天ギャラリー(最大3)から「商品写真だけ」を選び原寸で出品。空なら代表画像にフォールバック。
  const gallery = product.images?.length ? product.images : [product.imageUrl];
  const images = await filterProductImages(gallery);

  // Best Offer（値下げ交渉）: 既定ON。出品価格の90%以上は自動承諾、損益分岐(floor)未満は自動拒否。
  const bestOffer = body.bestOffer !== false;
  let autoAcceptUsd: string | undefined;
  let autoDeclineUsd: string | undefined;
  if (bestOffer) {
    autoAcceptUsd = (price * 0.9).toFixed(2); // 10%引きまで即承諾
    const floor = Number(body.floorUsd);
    // eBay制約: 自動拒否価格は自動承諾価格より低いこと。損益分岐がそれを満たす時だけ設定。
    if (Number.isFinite(floor) && floor > 0 && floor < price * 0.9) {
      autoDeclineUsd = floor.toFixed(2); // 損益分岐未満の赤字オファーは自動拒否
    }
  }

  const result = await createAndPublish(token, {
    productId: product.id,
    title,
    description,
    imageUrl: product.imageUrl,
    images,
    priceUsd: price.toFixed(2),
    condition: body.condition || "NEW",
    categoryId: body.categoryId,
    aspects,
    fulfillmentPolicyId: body.fulfillmentPolicyId,
    handlingDays: Number(body.handlingDays) > 0 ? Number(body.handlingDays) : undefined,
    quantity: Number(body.quantity) > 0 ? Number(body.quantity) : 1,
    bestOffer,
    autoAcceptUsd,
    autoDeclineUsd,
  });

  // オファー作成（下書き含む）できたら、出品者数を計上（SOLD飽和判定の元・乱立防止）。
  // 1端末は何度出しても +0（SADDで冪等）。押下数ではなく実出品数で数える。
  // ※これは「カタログの飽和検知」用。マイページの成績（件数・仕入れ額）は別で、公開完了(result.ok)だけを数える。
  if (result.offerId) {
    try {
      await kv.sadd(`listing_actors:${product.id}`, did);
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
  }

  // 「出品完了」＝eBayに公開できたものだけ記録する。下書き/本人確認待ち(result.ok=false)は成績に数えない。
  // ・SKU→商品ID（売却検知の逆引き）
  // ・マイページ成績の出品（件数・仕入れ額）。仕入れは楽天価格＋国内送料（＝実際に払った額）。
  if (result.ok) {
    try {
      await kv.hset(SKU_MAP_KEY(actor), { [skuForProduct(product.id)]: product.id });
      await kv.expire(SKU_MAP_KEY(actor), SKU_MAP_TTL);
    } catch {
      /* noop */
    }
    await recordListed(actor, product.id, {
      purchase: product.source.price + (product.source.shippingJpy ?? 0),
      points: product.source.pointAmount ?? 0,
      title: product.title,
      imageUrl: product.imageUrl,
      listedAt: new Date().toISOString(),
      listingId: result.listingId, // 「写真追加」でその出品へ直リンクするため公開IDを保存（再出品で変わったら更新）
    });
  }

  return Response.json(result);
}
