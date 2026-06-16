// eBay 出品（楽天画像を使った完全自動公開）のサーバー専用ロジック。
// 在庫アイテム(PUT) → オファー(POST/PUT) → 公開(publishOffer) を行う。
// カテゴリ/必須Item Specifics は Taxonomy API で取得（アプリトークン使用）。
import { skuForProduct } from "./sellApi";

const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const API = ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

export const MARKETPLACE = "EBAY_US";
export const SHIP_LOCATION_KEY = "jp-ship-from"; // 既存の在庫ロケーション
export const USD_JPY = 155; // realAvgPrice の換算に使った固定レート（refresh.mjs と一致）

// 楽天のmediumImageは _ex=128x128 等の小サムネ。eBayの大きい画像枠でボケるため、出品時は最大解像度に差し替える。
// ★ thumbnail.image.rakuten.co.jp(リサイズCDN・_ex=1200でも1200頭打ち)ではなく image.rakuten.co.jp(原寸オリジナル)を使う。
//   高解像度をアップしている店ほど鮮明になる。元画像が小さい店はそのサイズが上限(=これ以上は鮮明化不能)。
function upscaleListingImage(url: string): string {
  if (!url) return "";
  if (/thumbnail\.image\.rakuten\.co\.jp\/@0_mall\//.test(url)) {
    return url.replace("thumbnail.image.rakuten.co.jp/@0_mall/", "image.rakuten.co.jp/").replace(/\?_ex=\d+x\d+/, "");
  }
  return url.replace(/_ex=\d+x\d+/, "_ex=1200x1200"); // 別形式は従来どおりサイズ指定を上げる
}

// SKU→商品ID の対応表（端末単位）。売却検知の逆引きに使う。
export const SKU_MAP_KEY = (actor: string) => `ebay_sku_map:${actor}`;
// 逆引き表のTTL（365日）。長期在庫の出品が売れる前に失効しないよう、出品時に設定し
// 売却同期のたびに再延長する（skuForProduct は非可逆＝復元不能のため失効＝取りこぼし）。
export const SKU_MAP_TTL = 365 * 24 * 60 * 60;

// ── 低レベル fetch（詳細エラー抽出つき） ──
interface EbayError {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name?: string; value?: string }[];
}
interface EbayBody {
  errors?: EbayError[];
  [k: string]: unknown;
}
interface EbayResult {
  ok: boolean;
  status: number;
  data: EbayBody | null;
  error?: string;
}

function extractError(data: EbayBody | null, status: number): string {
  const e0 = data?.errors?.[0];
  if (!e0) return `HTTP ${status}`;
  const params = (e0.parameters ?? [])
    .map((p) => `${p.name ?? ""}=${p.value ?? ""}`)
    .filter((s) => s !== "=")
    .join(", ");
  return [e0.longMessage || e0.message, params && `(${params})`, e0.errorId && `#${e0.errorId}`]
    .filter(Boolean)
    .join(" ");
}

async function ebayFetch(
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<EbayResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // Inventory API は Accept-Language を要求する（未指定だと #25709 Invalid value）
        "Accept-Language": "en-US",
        // 書き込み(ペイロードあり)のみ Content-Language が必須
        ...(body ? { "Content-Type": "application/json", "Content-Language": "en-US" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data: EbayBody | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as EbayBody;
      } catch {
        data = null;
      }
    }
    if (res.ok || res.status === 201 || res.status === 204) {
      return { ok: true, status: res.status, data };
    }
    return { ok: false, status: res.status, data, error: extractError(data, res.status) };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
}

// ── カテゴリ / 必須Item Specifics（Taxonomy。アプリトークンで呼ぶ） ──
export interface CategorySuggestion {
  categoryTreeId: string;
  categoryId?: string;
  categoryName?: string;
}

export async function getCategorySuggestion(
  appToken: string,
  query: string,
  preferCondition?: string // 例 "NEW"。指定時は その状態を許可する候補を優先（used-only誤判定→#25021/Used誤表示を回避）
): Promise<CategorySuggestion | null> {
  const tree = await ebayFetch(
    appToken,
    "GET",
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${MARKETPLACE}`
  );
  const treeId = (tree.data as { categoryTreeId?: string } | null)?.categoryTreeId;
  if (!treeId) return null;
  const sug = await ebayFetch(
    appToken,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_suggestions?q=${encodeURIComponent(
      query.slice(0, 80)
    )}`
  );
  const cats = ((
    sug.data as { categorySuggestions?: { category?: { categoryId?: string; categoryName?: string } }[] } | null
  )?.categorySuggestions ?? [])
    .map((s) => s.category)
    .filter((c): c is { categoryId: string; categoryName?: string } => !!c?.categoryId);
  if (!cats.length) return { categoryTreeId: treeId };

  // 希望状態(例:NEW)が指定されていれば、それを許可する最初の候補を選ぶ。
  // eBayの先頭候補が used-only だと新品が出せず #25021／Used誤表示になるため、上位5件まで状態ポリシーを確認。
  const preferId = preferCondition ? ENUM_TO_CONDID[preferCondition] : undefined;
  if (preferId) {
    for (const c of cats.slice(0, 5)) {
      const allowed = await allowedConditionIds(appToken, c.categoryId);
      // allowed=null は「デフォルトポリシー(=New含む)」。null か 希望IDを含むカテゴリを採用。
      if (!allowed || allowed.has(preferId)) {
        return { categoryTreeId: treeId, categoryId: c.categoryId, categoryName: c.categoryName };
      }
    }
  }
  return { categoryTreeId: treeId, categoryId: cats[0].categoryId, categoryName: cats[0].categoryName };
}

export interface RequiredAspect {
  name: string;
  values: string[]; // 選択肢（あれば）
  free: boolean; // 自由入力可か
  required: boolean; // true=必須(空だと#25002で公開不可) / false=推奨(任意・埋めると検索に出やすい)
}

interface AspectDef {
  localizedAspectName?: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; aspectUsage?: string };
  aspectValues?: { localizedValue?: string }[];
}

export async function getRequiredAspects(
  appToken: string,
  treeId: string,
  categoryId: string
): Promise<RequiredAspect[]> {
  const r = await ebayFetch(
    appToken,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=${categoryId}`
  );
  const aspects = (r.data as { aspects?: AspectDef[] } | null)?.aspects ?? [];
  // 必須(aspectRequired)＋推奨(aspectUsage=RECOMMENDED)を返す。任意(OPTIONAL)は雑然とするので除外。
  // ★必須判定は aspectRequired のみで行う（eBay仕様: 必須項目でも aspectUsage は RECOMMENDED を返すため）。
  return aspects
    .filter((a) => a.aspectConstraint?.aspectRequired || a.aspectConstraint?.aspectUsage === "RECOMMENDED")
    .map((a) => ({
      name: a.localizedAspectName ?? "",
      values: (a.aspectValues ?? []).map((v) => v.localizedValue ?? "").filter(Boolean).slice(0, 30),
      free: a.aspectConstraint?.aspectMode !== "SELECTION_ONLY",
      required: !!a.aspectConstraint?.aspectRequired,
    }))
    .filter((a) => a.name);
}

// ── ビジネスポリシーID ──
export interface PolicyIds {
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
}

export async function getBusinessPolicyIds(token: string): Promise<PolicyIds> {
  const [f, p, r] = await Promise.all([
    ebayFetch(token, "GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`),
    ebayFetch(token, "GET", `/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`),
    ebayFetch(token, "GET", `/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`),
  ]);
  return {
    fulfillmentPolicyId: (f.data as { fulfillmentPolicies?: { fulfillmentPolicyId?: string }[] } | null)
      ?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId,
    paymentPolicyId: (p.data as { paymentPolicies?: { paymentPolicyId?: string }[] } | null)
      ?.paymentPolicies?.[0]?.paymentPolicyId,
    returnPolicyId: (r.data as { returnPolicies?: { returnPolicyId?: string }[] } | null)
      ?.returnPolicies?.[0]?.returnPolicyId,
  };
}

// 配送ポリシー一覧（名前＋一律送料USD）。出品画面で送料サイズを選ばせる用。
export interface ShippingChoice {
  fulfillmentPolicyId: string;
  name: string; // "Shipping Small" など
  costUsd: string; // 一律送料(USD)
}

interface FulfillmentPolicyRaw {
  fulfillmentPolicyId?: string;
  name?: string;
  shippingOptions?: { shippingServices?: { shippingCost?: { value?: string } }[] }[];
}

export async function listFulfillmentPolicies(token: string): Promise<ShippingChoice[]> {
  const r = await ebayFetch(token, "GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`);
  const pols = (r.data as { fulfillmentPolicies?: FulfillmentPolicyRaw[] } | null)?.fulfillmentPolicies ?? [];
  return pols
    .map((p) => {
      const costUsd =
        (p.shippingOptions ?? [])
          .flatMap((o) => o.shippingServices ?? [])
          .map((s) => s.shippingCost?.value)
          .find((v): v is string => !!v) ?? "";
      return { fulfillmentPolicyId: p.fulfillmentPolicyId ?? "", name: p.name ?? "", costUsd };
    })
    .filter((p) => p.fulfillmentPolicyId);
}

// ── 同等品の「現在の最安USD」（Browse API・現在出品ベース） ──
// 「最安で出して最速で売る」値付け用。セット/まとめ売りと、極端に安い外れ値(別物・破損・誤出品)を
// 除いた“ロバストな最安”を返す。失敗時 null。アプリトークン(client_credentials)で呼ぶ。
const LOWEST_SET_RE =
  /\b(lot of \d|set of \d|\d+\s*pcs|\d+\s*pieces|bundle|\d+\s*x\b|x\s*\d+|\d+\s*-?\s*pack|joblot|job lot|wholesale|\d+\s*set\b)\b/i;

export async function getLowestComparableUsd(appToken: string, query: string): Promise<number | null> {
  if (!query) return null;
  try {
    const params = new URLSearchParams({
      q: query.slice(0, 120),
      limit: "24",
      fieldgroups: "COMPACT",
      filter: "conditions:{NEW|LIKE_NEW}",
      sort: "price",
    });
    const res = await fetch(`${API}/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${appToken}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      itemSummaries?: { title?: string; price?: { value?: string; currency?: string } }[];
    };
    const usd = (data.itemSummaries ?? [])
      .filter((it) => !LOWEST_SET_RE.test(it.title ?? ""))
      .map((it) => (it.price?.currency === "USD" ? parseFloat(it.price?.value ?? "") : 0))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (usd.length === 0) return null;
    if (usd.length < 4) return usd[0]; // サンプル僅少→そのまま最安
    const med = usd[Math.floor(usd.length / 2)];
    const kept = usd.filter((v) => v >= med * 0.4); // 中央値の40%未満は別物/破損の疑い→除外
    return kept[0] ?? usd[0];
  } catch {
    return null;
  }
}

// ── 出品（作成→公開） ──
export interface PublishInput {
  productId: string;
  title: string;
  description: string;
  imageUrl: string;
  priceUsd: string; // 例 "24.99"
  condition: string; // "NEW" など
  images?: string[]; // 複数出品画像（フィルタ済み・原寸）。未指定/空なら imageUrl 単体を使う
  categoryId: string;
  aspects: Record<string, string[]>; // { Brand: ["Unbranded"], ... }
  fulfillmentPolicyId?: string; // 選んだ送料サイズのポリシー（未指定なら先頭）
  handlingDays?: number; // 発送までの日数（落札後）。未指定ならポリシーの既定値のまま。
  quantity?: number; // 出品個数（在庫数）。1〜30。未指定なら1。
  bestOffer?: boolean; // Best Offer(値下げ交渉)を有効化するか
  autoAcceptUsd?: string; // 自動承諾の下限。これ以上のオファーは自動承諾。例 "22.49"
  autoDeclineUsd?: string; // 自動拒否の上限。これ以下のオファーは自動拒否(損益分岐)。例 "17.00"
}

export interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
}

export interface PublishResult {
  ok: boolean;
  sku: string;
  offerId?: string;
  listingId?: string;
  steps: StepResult[];
  error?: string;
  needsSellerRegistration?: boolean; // 下書きは保存済み・セラー登録だけ未完で公開できなかった
  pendingVerification?: boolean; // 登録済みだが本人確認(KYC)の完了待ちで公開できない
  accountUnusable?: boolean; // アカウントが出品できる状態にない（制限/一時停止/出品権限なし 等）
}

async function findOfferId(token: string, sku: string): Promise<string | null> {
  const r = await ebayFetch(
    token,
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`
  );
  return (r.data as { offers?: { offerId?: string }[] } | null)?.offers?.[0]?.offerId ?? null;
}

async function upsertOffer(
  token: string,
  sku: string,
  body: Record<string, unknown>,
  steps: StepResult[]
): Promise<string | null> {
  const create = await ebayFetch(token, "POST", `/sell/inventory/v1/offer`, body);
  if (create.ok) {
    const id = (create.data as { offerId?: string } | null)?.offerId ?? (await findOfferId(token, sku));
    if (id) {
      steps.push({ step: "オファー作成", ok: true });
      return id;
    }
    // 作成は成功したが offerId が取得できない＝以降の公開に進めない。ステップも失敗として記録。
    steps.push({ step: "オファー作成", ok: false, error: "オファーIDを取得できませんでした" });
    return null;
  }
  // 既に存在 → 既存offerを更新
  if (/already|exist|duplicate|25002/i.test(create.error ?? "")) {
    const existing = await findOfferId(token, sku);
    if (existing) {
      const upd = await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${existing}`, body);
      steps.push({ step: "オファー更新", ok: upd.ok, error: upd.error });
      return upd.ok ? existing : null;
    }
  }
  steps.push({ step: "オファー作成", ok: false, error: create.error });
  return null;
}

// 選んだ配送ポリシーの「発送までの日数(handlingTime)」だけ更新する（GET→差し替え→PUT）。
// 送料・送り先など他項目は取得値を保持。ベストエフォート（失敗しても公開は続行）。
async function setPolicyHandlingTime(
  token: string,
  policyId: string,
  days: number
): Promise<{ ok: boolean; error?: string }> {
  const cur = await ebayFetch(token, "GET", `/sell/account/v1/fulfillment_policy/${policyId}`);
  if (!cur.ok || !cur.data) return { ok: false, error: cur.error || "配送ポリシーを取得できませんでした" };
  const rest: Record<string, unknown> = { ...cur.data };
  delete rest.fulfillmentPolicyId; // IDはURLで指定するためボディからは除く
  delete rest.warnings;
  const body = { ...rest, handlingTime: { value: days, unit: "DAY" } };
  const put = await ebayFetch(token, "PUT", `/sell/account/v1/fulfillment_policy/${policyId}`, body);
  return { ok: put.ok, error: put.error };
}

// ── 状態(condition)をカテゴリ対応に補正 ──
// eBayはカテゴリごとに使える conditionId が異なり、NEW(1000)を受けないカテゴリだと publish時に
// #25021「condition id is invalid for the category」で落ちる。カテゴリの許可conditionを取得して送る状態を補正する。
const ENUM_TO_CONDID: Record<string, string> = {
  NEW: "1000", LIKE_NEW: "2750", NEW_OTHER: "1500", NEW_WITH_DEFECTS: "1750",
  USED_EXCELLENT: "3000", USED_VERY_GOOD: "4000", USED_GOOD: "5000",
  USED_ACCEPTABLE: "6000", FOR_PARTS_OR_NOT_WORKING: "7000",
};
const CONDID_TO_ENUM: Record<string, string> = Object.fromEntries(
  Object.entries(ENUM_TO_CONDID).map(([k, v]) => [v, k])
);

async function allowedConditionIds(token: string, categoryId: string): Promise<Set<string> | null> {
  if (!categoryId) return null;
  const filter = encodeURIComponent(`categoryIds:{${categoryId}}`);
  const r = await ebayFetch(
    token,
    "GET",
    `/sell/metadata/v1/marketplace/${MARKETPLACE}/get_item_condition_policies?filter=${filter}`
  );
  if (!r.ok || !r.data) return null;
  const pol = (
    r.data as { itemConditionPolicies?: { itemConditions?: { conditionId?: string }[] }[] }
  ).itemConditionPolicies?.[0];
  const ids = (pol?.itemConditions ?? []).map((c) => String(c.conditionId)).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

// 希望状態がカテゴリで使えればそのまま、ダメでも「同じ系統(新品系/中古系)」の中だけで寄せる。
// 新品を中古(Used)に格下げ表示しない＝買い手に状態を偽らない（ユーザー方針）。同系統が無ければ希望状態のまま返す。
const NEW_FAMILY = ["1000", "1500", "1750", "2750"];   // New / New other / New w/defects / Like New
const USED_FAMILY = ["3000", "4000", "5000", "6000"];  // Used: Excellent / Very good / Good / Acceptable
function pickCondition(allowed: Set<string>, desiredEnum: string): string {
  const desiredId = ENUM_TO_CONDID[desiredEnum];
  if (desiredId && allowed.has(desiredId)) return desiredEnum;
  const sameFamily = NEW_FAMILY.includes(desiredId ?? "") ? NEW_FAMILY : USED_FAMILY;
  for (const id of sameFamily) if (allowed.has(id)) return CONDID_TO_ENUM[id];
  return desiredEnum; // 同系統に許可が無い→状態は偽らない（カテゴリ側で解決する）
}

// 取得失敗時は無補正（fail-open＝従来動作）。これにより本修正で状況が悪化することはない。
async function resolveCondition(token: string, categoryId: string, desiredEnum: string): Promise<string> {
  try {
    const allowed = await allowedConditionIds(token, categoryId);
    if (!allowed || allowed.size === 0) return desiredEnum;
    return pickCondition(allowed, desiredEnum);
  } catch {
    return desiredEnum;
  }
}

export async function createAndPublish(token: string, input: PublishInput): Promise<PublishResult> {
  const sku = skuForProduct(input.productId);
  const steps: StepResult[] = [];

  // 出品個数（在庫数）。1〜30にクランプ。未指定/不正なら1。
  const qty = Math.min(30, Math.max(1, Math.floor(input.quantity || 1)));

  // 説明文を eBay 用の簡易HTMLに整形（編集UIではプレーンのまま、公開時だけ変換）。
  // & < > をエスケープ → 見出し(【…】)とQ.行を太字 → 改行を <br>。
  const descHtml = (input.description || input.title)
    .slice(0, 4000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((l) => (/^\s*(【|Q\.)/.test(l) ? `<b>${l}</b>` : l))
    .join("<br>");

  // 状態をカテゴリが受け付ける値に補正（NEW非対応カテゴリでの #25021 を防ぐ。取得失敗時は無補正）。
  const condEnum = await resolveCondition(token, input.categoryId, input.condition);
  if (condEnum !== input.condition) {
    steps.push({ step: `状態をカテゴリ対応に補正（${input.condition}→${condEnum}）`, ok: true });
  }

  // 1) 在庫アイテム（楽天画像・タイトル・状態・必須項目）
  const itemBody = {
    availability: { shipToLocationAvailability: { quantity: qty } },
    condition: condEnum,
    product: {
      title: input.title.slice(0, 80),
      description: descHtml,
      imageUrls: (input.images?.length ? input.images : input.imageUrl ? [input.imageUrl] : [])
        .map(upscaleListingImage)
        .slice(0, 12), // eBayは最大12〜24枚。複数の商品写真で信頼度UP（原寸化は適用済みでも冪等）
      aspects: input.aspects,
    },
  };
  const item = await ebayFetch(
    token,
    "PUT",
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    itemBody
  );
  steps.push({ step: "商品情報を登録", ok: item.ok, error: item.error });
  if (!item.ok) return { ok: false, sku, steps, error: item.error };

  // 2) ポリシーID
  const pol = await getBusinessPolicyIds(token);
  if (!pol.fulfillmentPolicyId || !pol.paymentPolicyId || !pol.returnPolicyId) {
    steps.push({ step: "ポリシー確認", ok: false, error: "ビジネスポリシーが見つかりません" });
    return { ok: false, sku, steps, error: "ビジネスポリシーが未設定です。設定を完了してください。" };
  }
  const usedFulfillmentId = input.fulfillmentPolicyId || pol.fulfillmentPolicyId;

  // 2.5) 発送までの日数（任意）。eBayは handling time を配送ポリシーに持たせる仕様のため、
  //      選んだ配送ポリシーの handlingTime だけ更新する。失敗しても公開は続行（ベストエフォート）。
  if (input.handlingDays) {
    const days = Math.min(30, Math.max(1, Math.floor(input.handlingDays)));
    const upd = await setPolicyHandlingTime(token, usedFulfillmentId, days);
    steps.push({ step: `発送までの日数を${days}日に設定`, ok: upd.ok, error: upd.ok ? undefined : upd.error });
  }

  // 3) オファー（作成 or 更新）
  // 配送/支払い/返品ポリシー。Best Offer 有効時は bestOfferTerms で自動承諾/自動拒否の価格を設定する
  // （Sell Inventory API の正式機能。Trading API 不要）。
  const listingPolicies: Record<string, unknown> = {
    fulfillmentPolicyId: usedFulfillmentId,
    paymentPolicyId: pol.paymentPolicyId,
    returnPolicyId: pol.returnPolicyId,
  };
  if (input.bestOffer && input.autoAcceptUsd) {
    listingPolicies.bestOfferTerms = {
      bestOfferEnabled: true,
      autoAcceptPrice: { value: input.autoAcceptUsd, currency: "USD" },
      ...(input.autoDeclineUsd
        ? { autoDeclinePrice: { value: input.autoDeclineUsd, currency: "USD" } }
        : {}),
    };
  }
  const offerBody: Record<string, unknown> = {
    sku,
    marketplaceId: MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: qty,
    categoryId: input.categoryId,
    listingDescription: descHtml,
    pricingSummary: { price: { value: input.priceUsd, currency: "USD" } },
    listingPolicies,
    merchantLocationKey: SHIP_LOCATION_KEY,
  };
  let offerId = await upsertOffer(token, sku, offerBody, steps);
  // Best Offer 設定が原因で失敗した可能性に備え、bestOfferTerms を外して1回だけ再試行（出品自体は通す＝フェイルオープン）。
  if (!offerId && input.bestOffer) {
    delete listingPolicies.bestOfferTerms;
    steps.push({ step: "Best Offer無しで再試行", ok: true });
    offerId = await upsertOffer(token, sku, offerBody, steps);
  }
  if (!offerId) {
    return { ok: false, sku, steps, error: steps[steps.length - 1]?.error || "オファー作成に失敗しました" };
  }

  // 4) 公開
  const pub = await ebayFetch(token, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  const listingId = (pub.data as { listingId?: string } | null)?.listingId;
  // 公開できない時、下書き(在庫+オファー)は保存済み。状態別にやさしく案内する。
  // ① Payoneerの本人確認(KYC)待ち＝登録済みだが審査中。eBayの長い定型HTMLはそのまま出さない。
  const pendingVerify =
    !pub.ok &&
    /SRM_ROW_Payoneer|will contact you to verify|Payoneer will contact|verify your status|confirm your account is ready/i.test(
      pub.error ?? ""
    );
  // ② セラー登録そのものが未完
  const needsReg =
    !pub.ok &&
    !pendingVerify &&
    /SELLING_PRIVILEGE_REQUIRED|seller'?s account|create a seller|need .*seller account|register to sell/i.test(pub.error ?? "");
  // ③ アカウントが出品できる状態にない（制限/一時停止/出品権限の停止 等）。bug ではないので
  //    「開発者に報告」ではなく、利用者向けの落ち着いた注意書きへ回す。
  const accountUnusable =
    !pub.ok &&
    !pendingVerify &&
    !needsReg &&
    /suspended|restricted|account.*(hold|holds|blocked|disabled|not eligible|ineligible|limited|inactive)|not (allowed|permitted) to (list|sell)|cannot (list|sell)|selling.*(restricted|blocked|limited|not allowed)/i.test(
      pub.error ?? ""
    );
  const friendly = pendingVerify
    ? "アカウントの最終確認（本人確認）の完了待ちです。確認が取れると数日以内にメールが届きます。"
    : needsReg
    ? "セラー登録（売上の受け取り設定）がまだ完了していません。"
    : accountUnusable
    ? "現在、このeBayアカウントでは出品できない状態です（制限中、または確認中の可能性があります）。"
    : pub.error;
  steps.push({ step: "eBayに公開", ok: pub.ok, error: pub.ok ? undefined : friendly });
  if (!pub.ok)
    return {
      ok: false,
      sku,
      offerId,
      steps,
      error: friendly,
      needsSellerRegistration: needsReg,
      pendingVerification: pendingVerify,
      accountUnusable,
    };

  return { ok: true, sku, offerId, listingId, steps };
}
