import { cookies } from "next/headers";
import { kvReadOnly } from "../../../../lib/kv";
import { ProfitProduct } from "../../../../lib/profitFilter";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getAppAccessToken } from "../../../../lib/ebay/oauth";
import {
  getCategorySuggestion,
  getRequiredAspects,
  listFulfillmentPolicies,
  getLowestComparableUsd,
  USD_JPY,
  RequiredAspect,
} from "../../../../lib/ebay/listing";

// 利益計算と同じ係数（refresh.mjs と一致）。損益分岐の値付けに使う。
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED_JPY = 47;

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
  // 候補があれば（自由入力タイプでも）先頭を既定に。必須Item Specific の未入力(#25002)を防ぐ。
  if (a.values.length > 0) return a.values[0];
  return "";
}

// 状態の自動判定：大半は新品。楽天タイトルに「中古」等があるときだけ中古に。
function detectCondition(jaTitle: string): string {
  if (/中古|ユーズド|used|ジャンク/i.test(jaTitle)) {
    if (/非常に良い|美品|ほぼ新品|新品同様|like ?new/i.test(jaTitle)) return "USED_EXCELLENT";
    return "USED_GOOD";
  }
  return "NEW";
}

// 英語の説明文（編集可）。タイトルは英語(coreKeyword)を使う。
function buildDescription(enTitle: string, condition: string): string {
  const cond = condition === "NEW" ? "Brand new and unused." : "Pre-owned, in good condition.";
  return `${enTitle}\n\n${cond} Shipped directly from Japan with tracking. Carefully packaged. Please check the photo. Feel free to message me with any questions before purchase.`;
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

  // 既定の表示価格＝eBay最安ベース(realAvgPrice)。売り方「相場/はやく」は中央値を基準にするため medianUsd も返す。
  const priceUsd = Math.max(1, Math.round((product.realAvgPrice / USD_JPY) * 100) / 100).toFixed(2);
  const medianUsd =
    product.realMedianPrice && product.realMedianPrice > 0
      ? Math.max(1, Math.round((product.realMedianPrice / USD_JPY) * 100) / 100).toFixed(2)
      : priceUsd;

  // タイトルは英語(coreKeyword=マッチしたeBay商品の英語タイトル)を既定にする。
  const enTitle = (product.coreKeyword || product.title).slice(0, 80);
  const condition = detectCondition(product.title);
  const description = buildDescription(enTitle, condition);

  // カテゴリ + 必須Item Specifics（Taxonomy）。アプリトークン優先、不可ならユーザートークン。
  // 送料サイズ（配送ポリシー）一覧も取得。
  const taxoToken = (await getAppAccessToken()) || token;
  const [cat, shipping, lowestComparable] = await Promise.all([
    getCategorySuggestion(taxoToken, enTitle),
    listFulfillmentPolicies(token),
    getLowestComparableUsd(taxoToken, product.coreKeyword || enTitle), // 同等品の現在の最安USD（最速出品用）
  ]);

  // 損益分岐(USD)：このeBay価格を下回ると赤字になる下限。「最安で出す」時もここは割らない。
  // profit=0 ⇔ ebayJpy*(1-fee) - 固定手数料 = 仕入れ実質原価(楽天価格+国内送料-ポイント)。
  const effBuyJpy =
    product.source.price + (product.source.shippingJpy ?? 0) - (product.source.pointAmount ?? 0);
  const floorJpy = Math.max(1, (effBuyJpy + EBAY_FEE_FIXED_JPY) / (1 - EBAY_FEE_RATE));
  const floorUsd = (Math.round((floorJpy / USD_JPY) * 100) / 100).toFixed(2);
  const lowestUsd =
    lowestComparable && lowestComparable > 0 ? (Math.round(lowestComparable * 100) / 100).toFixed(2) : null;

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
        jaTitle: product.title,
        imageUrl: product.imageUrl,
        rakutenPrice: product.source.price,
        ebayAvgJpy: product.realAvgPrice,
      },
      title: enTitle,
      description,
      priceUsd,  // 既定の表示価格＝eBay最安ベース
      medianUsd, // 中央値USD（売り方「相場/はやく」の基準）
      lowestUsd, // 同等品の現在の最安USD（null=取得できず）
      floorUsd,  // 損益分岐USD（これ未満は赤字）
      condition,
      category: cat
        ? { categoryId: cat.categoryId, categoryName: cat.categoryName, categoryTreeId: cat.categoryTreeId }
        : null,
      requiredAspects,
      shipping,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
