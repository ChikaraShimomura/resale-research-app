import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { getActorId } from "../../../../lib/auth/actor";
import { getProductById } from "../../../../lib/ebay/productStore";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { createAndPublish, SKU_MAP_KEY, SKU_MAP_TTL } from "../../../../lib/ebay/listing";
import { filterProductImages } from "../../../../lib/ebay/imageFilter";
import { enhanceToEps } from "../../../../lib/ebay/imageProcess";
import { recordListed, listDealsForUser } from "../../../../lib/ebay/stats";
import { removeSourcing } from "../../../../lib/ebay/sourcing";
import { friendlyEbayError } from "../../../../lib/ebay/errorMessages";
import { SOLD_THRESHOLD } from "../../../../lib/sold";
import { getPlan, isUnlimited } from "../../../../lib/auth/plan";
import { PLANS, PAYWALL_ENABLED } from "../../../../lib/plans";
import { toRakutenProductUrl } from "../../../../lib/utils";

// 「eBay出品する」：在庫アイテム→オファー→公開を実行し、SKU→商品ID の対応表を保存する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像の取得→sharp加工→EPSアップロードで時間がかかるため上限を引き上げ

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
  selectedImages?: string[]; // ユーザーが出品画面で選んだ出品画像URL（先頭=メイン）。未指定なら自動選定
}

export async function POST(req: Request) {
  const actor = await getActorId();
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

  const product = await getProductById(body.productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  // 行為者のプラン。admin/master(あなた＋身内=無料・無制限)は満了・プラン上限の対象外。
  const plan = await getPlan();
  const comp = isUnlimited(plan);
  const did = (await cookies()).get("rr_did")?.value ?? actor;

  // 満了(SOLD)チェック：1商品につき最大 SOLD_THRESHOLD 人(端末)まで。既に出した端末は再出品OK(冪等)。
  if (!comp) {
    try {
      if (
        (await kv.scard(`listing_actors:${product.id}`)) >= SOLD_THRESHOLD &&
        !(await kv.sismember(`listing_actors:${product.id}`, did))
      ) {
        return Response.json({ ok: false, error: `この商品は出品上限（${SOLD_THRESHOLD}人）に達しました（満了）。別の商品をお試しください。` });
      }
    } catch {
      /* KV障害時はブロックしない（出品は通す） */
    }
  }

  // プラン上限(同時出品数)ゲート。Stripe決済が稼働するまで PAYWALL_ENABLED=OFF で無効（既存挙動を壊さない）。
  if (PAYWALL_ENABLED && !comp) {
    const limit = PLANS[plan].listingLimit; // plan は上で解決済み（admin/master/amateur/veteran/pro/free）
    // limit>0 のときだけ enforce。free(=0)は「未購読＝ゲート対象外」扱いとし、Stripe未実装の間に全員ロックアウトしない。
    if (Number.isFinite(limit) && limit > 0) {
      const { live } = await listDealsForUser(actor);
      if (!live.some((d) => d.id === product.id) && live.length >= limit) {
        return Response.json({
          ok: false,
          planLimitReached: true,
          error: `現在のプラン（${PLANS[plan].name}）の同時出品上限（${limit}件）に達しました。プランをアップグレードしてください。`,
        });
      }
    }
  }

  const title = (body.title || product.coreKeyword || product.title).slice(0, 80);
  // 必須項目（空値は送らない）。値は配列で渡す。
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(body.aspects ?? {})) {
    if (v && v.trim()) aspects[k] = [v.trim()];
  }

  const description =
    (body.description && body.description.trim()) ||
    `${title}\n\nShipped directly from Japan with tracking. Carefully packaged. Please check the photo.`;

  // 出品画像: ユーザーが出品画面で選んだ写真があればそれを使う（先頭=メイン）。
  // eBay上限＆EPS加工時間(maxDuration)を考え最大12枚に制限。重複は除去。
  // 選択が無ければ従来どおり 楽天ギャラリー(最大3)から「商品写真だけ」を自動選定。
  const picked = Array.isArray(body.selectedImages)
    ? Array.from(new Set(body.selectedImages.filter((u) => typeof u === "string" && /^https?:\/\//.test(u)))).slice(0, 12)
    : [];
  const baseImages = picked.length
    ? picked
    : await filterProductImages(product.images?.length ? product.images : [product.imageUrl]);
  // 品質加工(無料sharp): 楽天画像を取得→1600px正方白背景・シャープ→EPSへ載せ替え(全EPS化で混在も回避)。
  // 失敗時は元の楽天URLのまま出品(fail-open)＝出品は必ず通る。
  let images = baseImages;
  try {
    const enhanced = await enhanceToEps(token, baseImages);
    if (enhanced && enhanced.length) images = enhanced;
  } catch {
    /* fail-open: 元URLのまま */
  }

  // Best Offer（値下げ交渉）: 既定ON。出品価格の90%以上は自動承諾、損益分岐(floor)未満は自動拒否。
  const bestOffer = body.bestOffer !== false;
  let autoAcceptUsd: string | undefined;
  let autoDeclineUsd: string | undefined;
  if (bestOffer) {
    const floor = Number(body.floorUsd);
    const hasFloor = Number.isFinite(floor) && floor > 0;
    // 自動承諾は「10%引き」だが損益分岐(floor)は絶対に割らない＝赤字を即確定させない。出品価格は上限。
    const accept = Math.min(price, hasFloor ? Math.max(price * 0.9, floor) : price * 0.9);
    autoAcceptUsd = accept.toFixed(2);
    // 自動拒否は floor 未満(赤字)を弾く。eBay制約で 拒否価格 < 承諾価格 のため、等しくならないよう僅かに下げる。
    if (hasFloor) {
      const decline = Math.min(floor, accept - 0.01);
      if (decline > 0 && decline < accept) autoDeclineUsd = decline.toFixed(2);
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

  // オファー作成(下書き含む)できたら出品者数を計上（満了=上限判定の元）。SADDで端末単位・冪等。
  // コンプ枠は枠を消費しない（あなた＝身内が何度出してもSOLDにしない）。
  if (result.offerId && !comp) {
    try {
      await kv.sadd(`listing_actors:${product.id}`, did);
      await kv.expire(`listing_actors:${product.id}`, 90 * 24 * 60 * 60);
    } catch {
      /* noop */
    }
  }

  // 「出品完了」＝eBayに公開できたものだけ記録する。下書き/本人確認待ち(result.ok=false)は成績に数えない。
  // ・SKU→商品ID（売却検知の逆引き）
  // ・マイページ成績の出品（件数・仕入れ額）。仕入れは楽天価格＋国内送料（＝実際に払った額）。
  if (result.ok) {
    try {
      // 実際に公開に使ったSKU（自己修復で rr-{id}-{乱数} になり得る）で対応表を書く。
      await kv.hset(SKU_MAP_KEY(actor), { [result.sku]: product.id });
      await kv.expire(SKU_MAP_KEY(actor), SKU_MAP_TTL);
    } catch {
      /* noop */
    }
    await recordListed(actor, product.id, {
      purchase: product.source.price + (product.source.shippingJpy ?? 0),
      points: product.source.pointAmount ?? 0,
      title: product.title,
      imageUrl: product.imageUrl,
      sourceUrl: toRakutenProductUrl(product.source.url) || undefined, // 「仕入れ」ボタンの直リンク。出品時に焼き込めば backfill 不要
      listedAt: new Date().toISOString(),
      listingId: result.listingId, // 「写真追加」でその出品へ直リンクするため公開IDを保存（再出品で変わったら更新）
      sku: result.sku, // アプリ内編集(価格/数量)の対象オファー特定に使う
    });
    // 出品できたら「仕入れ中」からは外す（→ 出品中一覧へ移る）。
    try {
      await removeSourcing(actor, product.id);
    } catch {
      /* noop */
    }
  }

  // 生のeBayエラーをユーザー向けの端的な文に変換（既知=要因／未知=「予期せぬエラー」＋報告ボタン）。
  // notready系(本人確認待ち/未登録/連携切れ)は専用UIで扱うので変換しない。生エラーは errorDetail に温存（報告用）。
  if (!result.ok && result.error && !result.needsSellerRegistration && !result.pendingVerification && !result.accountUnusable) {
    const f = friendlyEbayError(result.error);
    // ステップ一覧にも生eBayエラーが残るため、各失敗ステップも友好文化（生は errorDetail に温存）。
    const steps = result.steps?.map((s) =>
      s.ok || !s.error ? s : { ...s, error: friendlyEbayError(s.error).message, errorDetail: s.error }
    );
    return Response.json({ ...result, steps, error: f.message, errorKind: f.known ? "known" : "unexpected", errorDetail: result.error });
  }
  return Response.json(result);
}
