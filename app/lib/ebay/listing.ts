// eBay 出品（楽天画像を使った完全自動公開）のサーバー専用ロジック。
// 在庫アイテム(PUT) → オファー(POST/PUT) → 公開(publishOffer) を行う。
// カテゴリ/必須Item Specifics は Taxonomy API で取得（アプリトークン使用）。
import { skuForProduct } from "./sellApi";

const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const API = ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

export const MARKETPLACE = "EBAY_US";
export const SHIP_LOCATION_KEY = "jp-ship-from"; // 既存の在庫ロケーション
export const USD_JPY = 155; // realAvgPrice の換算に使った固定レート（refresh.mjs と一致）

// SKU→商品ID の対応表（端末単位）。売却検知の逆引きに使う。
export const SKU_MAP_KEY = (actor: string) => `ebay_sku_map:${actor}`;

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
  query: string
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
  const first = (
    sug.data as { categorySuggestions?: { category?: { categoryId?: string; categoryName?: string } }[] } | null
  )?.categorySuggestions?.[0]?.category;
  return { categoryTreeId: treeId, categoryId: first?.categoryId, categoryName: first?.categoryName };
}

export interface RequiredAspect {
  name: string;
  values: string[]; // 選択肢（あれば）
  free: boolean; // 自由入力可か
}

interface AspectDef {
  localizedAspectName?: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string };
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
  return aspects
    .filter((a) => a.aspectConstraint?.aspectRequired)
    .map((a) => ({
      name: a.localizedAspectName ?? "",
      values: (a.aspectValues ?? []).map((v) => v.localizedValue ?? "").filter(Boolean).slice(0, 30),
      free: a.aspectConstraint?.aspectMode !== "SELECTION_ONLY",
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

// ── 出品（作成→公開） ──
export interface PublishInput {
  productId: string;
  title: string;
  description: string;
  imageUrl: string;
  priceUsd: string; // 例 "24.99"
  condition: string; // "NEW" など
  categoryId: string;
  aspects: Record<string, string[]>; // { Brand: ["Unbranded"], ... }
  fulfillmentPolicyId?: string; // 選んだ送料サイズのポリシー（未指定なら先頭）
  handlingDays?: number; // 発送までの日数（落札後）。未指定ならポリシーの既定値のまま。
  quantity?: number; // 出品個数（在庫数）。1〜30。未指定なら1。
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
    steps.push({ step: "オファー作成", ok: true });
    return (create.data as { offerId?: string } | null)?.offerId ?? (await findOfferId(token, sku));
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

export async function createAndPublish(token: string, input: PublishInput): Promise<PublishResult> {
  const sku = skuForProduct(input.productId);
  const steps: StepResult[] = [];

  // 出品個数（在庫数）。1〜30にクランプ。未指定/不正なら1。
  const qty = Math.min(30, Math.max(1, Math.floor(input.quantity || 1)));

  // 1) 在庫アイテム（楽天画像・タイトル・状態・必須項目）
  const itemBody = {
    availability: { shipToLocationAvailability: { quantity: qty } },
    condition: input.condition,
    product: {
      title: input.title.slice(0, 80),
      description: (input.description || input.title).slice(0, 4000),
      imageUrls: input.imageUrl ? [input.imageUrl] : [],
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
  const offerBody: Record<string, unknown> = {
    sku,
    marketplaceId: MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: qty,
    categoryId: input.categoryId,
    listingDescription: (input.description || input.title).slice(0, 4000),
    pricingSummary: { price: { value: input.priceUsd, currency: "USD" } },
    listingPolicies: {
      fulfillmentPolicyId: usedFulfillmentId,
      paymentPolicyId: pol.paymentPolicyId,
      returnPolicyId: pol.returnPolicyId,
    },
    merchantLocationKey: SHIP_LOCATION_KEY,
  };
  const offerId = await upsertOffer(token, sku, offerBody, steps);
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
  const friendly = pendingVerify
    ? "アカウントの最終確認（本人確認）の完了待ちです。確認が取れると数日以内にメールが届きます。"
    : needsReg
    ? "セラー登録（売上の受け取り設定）がまだ完了していません。"
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
    };

  return { ok: true, sku, offerId, listingId, steps };
}
