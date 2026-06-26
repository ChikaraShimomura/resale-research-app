// eBay 出品（楽天画像を使った完全自動公開）のサーバー専用ロジック。
// 在庫アイテム(PUT) → オファー(POST/PUT) → 公開(publishOffer) を行う。
// カテゴリ/必須Item Specifics は Taxonomy API で取得（アプリトークン使用）。
import { skuForProduct, isNoOpUpdate } from "./sellApi";
// USD_JPY は SSOT(landedCostCore・env駆動/既定155)から取得＝各所のハードコード155を一本化（ドリフト防止）。
import { USD_JPY } from "./landedCostCore.mjs";

const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const API = ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

export const MARKETPLACE = "EBAY_US";
export const SHIP_LOCATION_KEY = "jp-ship-from"; // 既存の在庫ロケーション
export { USD_JPY }; // realAvgPrice の換算レート（再エクスポート＝既存の `from "./listing"` 取り込みを維持）

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

// 説明文（プレーンテキスト）を eBay 用の簡易HTMLに整形する。
// & < > をエスケープ → 見出し(【…】)とQ.行を太字 → 改行を <br>。
// 出品(createAndPublish)と最適化(reviseInventoryItemContent 経由)で同じ見た目にするため共用する。
export function descriptionToHtml(text: string): string {
  return (text || "")
    .slice(0, 4000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((l) => (/^\s*(【|Q\.|■)/.test(l) ? `<b>${l}</b>` : l))
    .join("<br>");
}

// SKU→商品ID の対応表（端末単位）。売却検知の逆引きに使う。
export const SKU_MAP_KEY = (actor: string) => `ebay_sku_map:${actor}`;
// 逆引き表のTTL（2年）。長期在庫の出品が売れる前に失効しないよう、出品時に設定し
// 売却同期のたびに再延長する（skuForProduct は非可逆＝復元不能のため失効＝取りこぼし）。
// 取引履歴(ebay_deals)の2年保持と揃える（出品中の公開判定に使うため）。
export const SKU_MAP_TTL = 730 * 24 * 60 * 60;

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
  // 通常エラーは data.errors[0]。bulk系API(bulk_update_price_quantity等)はHTTP 400でも
  // 詳細を data.responses[0].errors[0] にネストして返すため、両方を見る（でないと「HTTP 400」だけになり原因不明＝予期せぬエラー化）。
  const nested = (data as { responses?: { errors?: EbayError[] }[] } | null)?.responses;
  const e0 = data?.errors?.[0] ?? (Array.isArray(nested) ? nested.find((r) => r?.errors?.length)?.errors?.[0] : undefined);
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

export interface ComparableMarket {
  lowestUsd: number | null;   // 同等品の現在の最安USD（最速出品の価格基準）
  activeCount: number | null; // 同キーワードのeBay現在出品総数（競合の目安。Browseの total・概算）
}

// 同等品の「最安値」と「競合数」を1回のBrowse検索でまとめて取得する（total は同一レスポンスにあるので追加コストゼロ）。
// クエリ・条件は価格表示と同一なので、競合数の信頼度も既存の最安/中央値表示と同等。
export async function getComparableMarket(appToken: string, query: string): Promise<ComparableMarket> {
  if (!query) return { lowestUsd: null, activeCount: null };
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
    if (!res.ok) return { lowestUsd: null, activeCount: null };
    const data = (await res.json()) as {
      total?: number;
      itemSummaries?: { title?: string; price?: { value?: string; currency?: string } }[];
    };
    const activeCount = Number.isFinite(data.total) ? (data.total as number) : null;
    const usd = (data.itemSummaries ?? [])
      .filter((it) => !LOWEST_SET_RE.test(it.title ?? ""))
      .map((it) => (it.price?.currency === "USD" ? parseFloat(it.price?.value ?? "") : 0))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    let lowestUsd: number | null = null;
    if (usd.length > 0) {
      if (usd.length < 4) {
        lowestUsd = usd[0]; // サンプル僅少→そのまま最安
      } else {
        const med = usd[Math.floor(usd.length / 2)];
        const kept = usd.filter((v) => v >= med * 0.4); // 中央値の40%未満は別物/破損の疑い→除外
        lowestUsd = kept[0] ?? usd[0];
      }
    }
    return { lowestUsd, activeCount };
  } catch {
    return { lowestUsd: null, activeCount: null };
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
  ean?: string; // JAN/EAN(13/8桁)。あれば product.ean に載せ、eBayカタログ一致時に公式ストック画像/必須項目を自動添付(fail-open)
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
  healedSku?: boolean; // 固定SKUがeBay側で別管理になり詰んだため、新SKUで出し直した
  listingConflict?: boolean; // eBay側に競合する出品が存在し、新SKUでも公開できなかった（手動削除が必要）
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
  // 既に存在 → 既存offerを更新。
  // ⚠️ #25002 は「重複」ではなく「必須Item Specific不足」＝ここに含めると入力不足を既存offer探索へ逸らし真因を隠す。
  //    重複は "already exists"/"already exist"/"duplicate" の語だけで判定する（25002は除外＝上位へ正しく伝播）。
  if (/already exist|duplicate/i.test(create.error ?? "")) {
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
  // 発送日数が既に同値なら eBay は 20403「same as in the system」で弾くが、これは変更不要＝成功扱い。
  return { ok: put.ok || isNoOpUpdate(put.error), error: put.ok || isNoOpUpdate(put.error) ? undefined : put.error };
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

// 競合エラー＝その商品の出品が eBayサイト/別ツールで管理されていて Inventory API から触れない状態。
// eBay #21919474 / "not allowed for inventory items" / "refer to the tool used to create this listing"。
const LISTING_CONFLICT_RE =
  /not allowed for inventory items|inventory-based listing management is not currently supported|refer to the tool used to create this listing|21919474/i;

// 固定SKUがeBay側で「別管理」になり詰んだ時に使う、衝突しない新しいユニークSKU（rr-{商品ID}-{乱数}）。
function mintSku(productId: string): string {
  const base = skuForProduct(productId).slice(0, 43);
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base}-${nonce}`;
}

// 出品（作成→公開）。まず固定SKU `rr-{商品ID}` で試す（再出品は同SKU更新で冪等＝重複しない）。
// eBay側で別管理になって詰んでいる(#21919474等)時だけ、新しいユニークSKUで作り直して自己修復する。
// 返す sku は実際に使われたSKU＝呼び出し側はこれを SKU対応表に保存する（売却検知の逆引き鍵）。
export async function createAndPublish(token: string, input: PublishInput): Promise<PublishResult> {
  const first = await publishWithSku(token, input, skuForProduct(input.productId));
  if (first.ok) return first;
  // 競合以外の失敗（ポリシー未設定・本人確認待ち・価格不正 等）はそのまま返す。
  if (!LISTING_CONFLICT_RE.test(first.error ?? "")) return first;
  // 固定SKUの出品がeBayサイト/別ツール管理に移って詰んでいる → 新SKUで作り直す。
  const healed = await publishWithSku(token, input, mintSku(input.productId));
  healed.steps.unshift({
    step: "既存SKUがeBay側で別管理のため、新しいSKUで出し直し",
    ok: healed.ok,
    error: healed.ok ? undefined : healed.error,
  });
  healed.healedSku = true;
  // 新SKUでも競合（稀: eBay側に同一商品のライブ出品が別途ある）なら、やさしい案内に差し替える。
  if (!healed.ok && LISTING_CONFLICT_RE.test(healed.error ?? "")) {
    healed.error =
      "この商品はeBay側で作成・編集された別の出品と競合しています。お手数ですが、eBayでその出品を一度削除してから、もう一度出品してください。";
    healed.listingConflict = true;
  }
  return healed;
}

async function publishWithSku(token: string, input: PublishInput, sku: string): Promise<PublishResult> {
  const steps: StepResult[] = [];

  // 出品個数（在庫数）。1〜30にクランプ。未指定/不正なら1。
  const qty = Math.min(30, Math.max(1, Math.floor(input.quantity || 1)));

  // 説明文を eBay 用の簡易HTMLに整形（編集UIではプレーンのまま、公開時だけ変換）。
  const descHtml = descriptionToHtml(input.description || input.title);

  // 状態をカテゴリが受け付ける値に補正（NEW非対応カテゴリでの #25021 を防ぐ。取得失敗時は無補正）。
  const condEnum = await resolveCondition(token, input.categoryId, input.condition);
  if (condEnum !== input.condition) {
    steps.push({ step: `状態をカテゴリ対応に補正（${input.condition}→${condEnum}）`, ok: true });
  }

  // 1) 在庫アイテム（楽天画像・タイトル・状態・必須項目）
  // JAN/EAN(13/8桁)があれば product.ean に載せる＝eBayがカタログ一致時に「公式ストック画像」と必須項目を
  // 自動添付(正規ルート・規約OK)。不一致/無しでも従来の楽天画像で出品は必ず通る(fail-open)。
  const eanDigits = (input.ean || "").replace(/\D/g, "");
  const eanOk = eanDigits.length === 13 || eanDigits.length === 8;
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
      ...(eanOk ? { ean: [eanDigits] } : {}),
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
  // 配送/支払い/返品ポリシー（Best Offer は廃止＝値下げ交渉は付けない・ユーザー指示2026-06-27）。
  const listingPolicies: Record<string, unknown> = {
    fulfillmentPolicyId: usedFulfillmentId,
    paymentPolicyId: pol.paymentPolicyId,
    returnPolicyId: pol.returnPolicyId,
  };
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
  const offerId = await upsertOffer(token, sku, offerBody, steps);
  if (!offerId) {
    return { ok: false, sku, steps, error: steps[steps.length - 1]?.error || "オファー作成に失敗しました" };
  }

  // 4) 公開
  // eBayの在庫アイテムは結果整合性があり、PUT直後の publishOffer が在庫(availability)をまだ見つけられず
  // #25604「Availability not found（Please try again）」を返すことがある（intermittent）。
  // その場合だけ、在庫アイテムの availability を冪等PUTで再アサート＋短時間待ちして、最大2回まで再公開する。
  let pub = await ebayFetch(token, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
  for (let attempt = 1; attempt <= 2 && !pub.ok && /25604|availability not found/i.test(pub.error ?? ""); attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt));
    await ebayFetch(token, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, itemBody);
    pub = await ebayFetch(token, "POST", `/sell/inventory/v1/offer/${offerId}/publish`);
    steps.push({ step: `在庫の反映待ちで公開を再試行（${attempt}回目）`, ok: pub.ok, error: pub.ok ? undefined : pub.error });
  }
  const listingId = (pub.data as { listingId?: string } | null)?.listingId;
  // 公開できない時、下書き(在庫+オファー)は保存済み。状態別にやさしく案内する。
  // ⓪ 出品上限(件数/金額)に到達。「制限中(accountUnusable)」やセラー登録未完と混同しないよう"先に"判定し、
  //    生エラーを温存して route 側の friendlyEbayError で「上限の引き上げ」を案内する（notready扱いにしない）。
  const sellingLimit =
    !pub.ok &&
    /selling limit|monthly selling limit|number of items you can list|items you can list|maximum number of items you|exceed.*selling|reached your (selling|listing)|amount you can sell|value you can sell|21919303|21916920|21919508/i.test(
      pub.error ?? ""
    );
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
    !sellingLimit &&
    /SELLING_PRIVILEGE_REQUIRED|seller'?s account|create a seller|need .*seller account|register to sell/i.test(pub.error ?? "");
  // ③ アカウントが出品できる状態にない（制限/一時停止/出品権限の停止 等）。bug ではないので
  //    「開発者に報告」ではなく、利用者向けの落ち着いた注意書きへ回す。
  const accountUnusable =
    !pub.ok &&
    !pendingVerify &&
    !needsReg &&
    !sellingLimit &&
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

// ── 出品中の参照・編集（アプリ内で価格/数量を直す＝eBay.comを触らせない＝管理が外れる原因を断つ） ──
export interface CurrentOffer {
  offerId: string;
  priceUsd?: string;
  quantity?: number;
  listingId?: string;
  status?: string; // PUBLISHED / UNPUBLISHED 等
  fulfillmentPolicyId?: string; // 現在の配送(送料)ポリシー＝送料込み/別の判定に使う
}

// SKUから現在のオファー（価格・数量・公開ID）を取得。編集モーダルのプリフィルに使う。
export async function getOfferForSku(token: string, sku: string): Promise<CurrentOffer | null> {
  const r = await ebayFetch(
    token,
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`
  );
  const o = (
    r.data as {
      offers?: {
        offerId?: string;
        availableQuantity?: number;
        status?: string;
        pricingSummary?: { price?: { value?: string } };
        listing?: { listingId?: string };
        listingPolicies?: { fulfillmentPolicyId?: string };
      }[];
    } | null
  )?.offers?.[0];
  if (!o?.offerId) return null;
  return {
    offerId: o.offerId,
    priceUsd: o.pricingSummary?.price?.value,
    quantity: o.availableQuantity,
    listingId: o.listing?.listingId,
    status: o.status,
    fulfillmentPolicyId: o.listingPolicies?.fulfillmentPolicyId,
  };
}

// 出品中の価格・数量を更新（bulk_update_price_quantity）。公開済みの出品にも即反映される。
export async function updateOfferPriceQuantity(
  token: string,
  sku: string,
  offerId: string,
  opts: { priceUsd?: string; quantity?: number }
): Promise<{ ok: boolean; error?: string }> {
  const offer: Record<string, unknown> = { offerId };
  if (opts.quantity != null) offer.availableQuantity = opts.quantity;
  if (opts.priceUsd != null) offer.price = { value: opts.priceUsd, currency: "USD" };
  const body = {
    requests: [
      {
        sku,
        ...(opts.quantity != null ? { shipToLocationAvailability: { quantity: opts.quantity } } : {}),
        offers: [offer],
      },
    ],
  };
  const r = await ebayFetch(token, "POST", `/sell/inventory/v1/bulk_update_price_quantity`, body);
  if (!r.ok) return { ok: false, error: r.error };
  // bulk APIは200でも各要素に statusCode/errors を返すので、要素レベルの失敗を拾う。
  const resp = (
    r.data as { responses?: { statusCode?: number; errors?: { message?: string; longMessage?: string }[] }[] } | null
  )?.responses?.[0];
  if (resp?.statusCode && resp.statusCode >= 300) {
    return { ok: false, error: resp.errors?.[0]?.longMessage || resp.errors?.[0]?.message || `status ${resp.statusCode}` };
  }
  return { ok: true };
}

// 出品中の「価格(+数量)」を更新する。bulk_update_price_quantity と違い Best Offer の自動承諾/拒否額も
// 新価格に合わせて作り直す。eBayは「自動承諾額 < 出品価格」を厳密に要求するため、価格を下げると
// 出品時に設定した旧しきい値(≈定価の90%)が新価格を上回り "price must be greater than … auto-accept" で拒否される。
// フルoffer(GET→価格差し替え＋Best Offer除去→PUT)で更新し、公開中の listing に即反映する。
// Best Offer は廃止したので、価格変更のたびに既存出品の bestOfferTerms も外す（移行も兼ねる）。
export async function updateOfferPriceFull(
  token: string,
  offerId: string,
  opts: { priceUsd: string; quantity?: number }
): Promise<{ ok: boolean; error?: string }> {
  const g = await ebayFetch(token, "GET", `/sell/inventory/v1/offer/${offerId}`);
  if (!g.ok || !g.data || typeof g.data !== "object") return { ok: false, error: g.error || "オファー取得失敗" };
  const o: Record<string, unknown> = { ...(g.data as Record<string, unknown>) };
  delete o.offerId; delete o.listing; delete o.status; // 読み取り専用はPUTに含めない
  o.pricingSummary = { ...((o.pricingSummary as Record<string, unknown>) || {}), price: { value: opts.priceUsd, currency: "USD" } };
  if (opts.quantity != null) o.availableQuantity = opts.quantity;
  const lp: Record<string, unknown> = { ...((o.listingPolicies as Record<string, unknown>) || {}) };
  delete lp.bestOfferTerms; // 値下げ交渉は付けない（旧しきい値との衝突=「価格の指定に問題」も根治）
  o.listingPolicies = lp;
  const r = await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${offerId}`, o);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

// 公開中の出品から Best Offer（値下げ交渉）を外す。既存出品の一括移行に使う。
// bestOfferTerms が無ければ no-op（changed:false）。フルoffer PUT で公開中 listing にも即反映。
export async function disableBestOfferForOffer(
  token: string,
  offerId: string
): Promise<{ ok: boolean; changed: boolean; error?: string }> {
  const g = await ebayFetch(token, "GET", `/sell/inventory/v1/offer/${offerId}`);
  if (!g.ok || !g.data || typeof g.data !== "object") return { ok: false, changed: false, error: g.error || "オファー取得失敗" };
  const o: Record<string, unknown> = { ...(g.data as Record<string, unknown>) };
  const lp = { ...((o.listingPolicies as Record<string, unknown>) || {}) };
  if (!lp.bestOfferTerms) return { ok: true, changed: false }; // 既にBest Offer無し
  delete o.offerId; delete o.listing; delete o.status;
  delete lp.bestOfferTerms;
  o.listingPolicies = lp;
  const r = await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${offerId}`, o);
  if (!r.ok) return { ok: false, changed: false, error: r.error };
  return { ok: true, changed: true };
}

// 出品中の「送料の出し方」を切替: 価格と配送ポリシーを同時更新する。
// bulk_update_price_quantity は配送ポリシーを変えられないため、フルoffer(GET→必要部だけ差し替え→PUT)で更新する。
// 公開中(PUBLISHED)のオファーをPUTで更新すると、出品中の listing にも反映される。
export async function updateOfferShipping(
  token: string,
  offerId: string,
  opts: { priceUsd: string; fulfillmentPolicyId: string }
): Promise<{ ok: boolean; error?: string }> {
  // フルofferを取得し、価格と配送ポリシーだけ差し替えて戻す（他フィールドは欠落させない）。
  const g = await ebayFetch(token, "GET", `/sell/inventory/v1/offer/${offerId}`);
  if (!g.ok || !g.data || typeof g.data !== "object") return { ok: false, error: g.error || "オファー取得失敗" };
  const o: Record<string, unknown> = { ...(g.data as Record<string, unknown>) };
  // 読み取り専用フィールドはPUTに含めない（含めると拒否される）。
  delete o.offerId; delete o.listing; delete o.status;
  o.pricingSummary = { ...((o.pricingSummary as Record<string, unknown>) || {}), price: { value: opts.priceUsd, currency: "USD" } };
  const lp: Record<string, unknown> = { ...((o.listingPolicies as Record<string, unknown>) || {}), fulfillmentPolicyId: opts.fulfillmentPolicyId };
  delete lp.bestOfferTerms; // 値下げ交渉は廃止。旧しきい値を残すと新価格と衝突して「価格の指定に問題」で拒否されるため必ず外す。
  o.listingPolicies = lp;
  const r = await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${offerId}`, o);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

// 出品停止: 公開中のオファーを取り下げて eBay の出品を終了する（withdrawOffer）。
// オファー自体は残す（status=UNPUBLISHED）ので、あとで再出品できる。
// 出品が無い/既に未公開の時は ended:false で成功扱い（冪等＝押しても害がない）。
export async function withdrawListingForSku(
  token: string,
  sku: string
): Promise<{ ok: boolean; ended: boolean; error?: string }> {
  const offer = await getOfferForSku(token, sku);
  if (!offer) return { ok: true, ended: false }; // 出品が存在しない（未公開/未作成）
  if (offer.status && offer.status !== "PUBLISHED") return { ok: true, ended: false }; // 既に未公開
  const r = await ebayFetch(token, "POST", `/sell/inventory/v1/offer/${offer.offerId}/withdraw`);
  if (r.ok) return { ok: true, ended: true };
  // 既に未公開/終了済みは「終了済み」とみなし成功扱い（冪等）。
  if (/not published|isn'?t published|already|ended/i.test(r.error ?? "")) return { ok: true, ended: false };
  return { ok: false, ended: false, error: r.error };
}

// ── 実物写真の追加（在庫アイテムの画像を差し替え。公開中の出品にも即反映） ──
// 在庫アイテムをGETで読む（imageUrlsのマージや状態維持のため。PUTは全置換なので既存値を欠かさず再送する）。
export async function getInventoryItem(token: string, sku: string): Promise<Record<string, unknown> | null> {
  const r = await ebayFetch(token, "GET", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`);
  if (!r.ok || !r.data) return null;
  return r.data as Record<string, unknown>;
}

// 既存の在庫アイテムを読み、product.imageUrls だけ新しい配列（全EPS）に差し替えてPUT。
// title/aspects/condition/availability 等は読み取った値をそのまま再送して欠落させない。
export async function updateInventoryItemImages(
  token: string,
  sku: string,
  imageUrls: string[]
): Promise<{ ok: boolean; error?: string }> {
  const item = await getInventoryItem(token, sku);
  if (!item) {
    return { ok: false, error: "この出品の商品情報を取得できませんでした（eBay側で削除/別管理の可能性）。再出品し直してください。" };
  }
  const product = { ...((item.product as Record<string, unknown>) ?? {}), imageUrls: imageUrls.slice(0, 24) };
  const body: Record<string, unknown> = { product };
  if (item.availability != null) body.availability = item.availability;
  if (item.condition != null) body.condition = item.condition;
  if (item.conditionDescription != null) body.conditionDescription = item.conditionDescription;
  if (item.packageWeightAndSize != null) body.packageWeightAndSize = item.packageWeightAndSize;
  const r = await ebayFetch(token, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, body);
  return { ok: r.ok, error: r.error };
}

// ── 出品の「タイトル・説明・Item Specifics」を改訂（返品最小化テンプレへの最適化） ──
// 在庫アイテムをGETし、product.title / product.description / product.aspects だけ差し替えてPUT。
// 価格・数量・状態(condition)・画像(imageUrls)・梱包サイズ等は読み取った値をそのまま再送して変えない
//（最適化＝買い手に見える文言だけを直す。在庫や状態を偽らない）。aspects は既存にマージし、渡した項目だけ上書きする。
export async function reviseInventoryItemContent(
  token: string,
  sku: string,
  fields: { title?: string; descriptionHtml?: string; aspects?: Record<string, string> }
): Promise<{ ok: boolean; error?: string }> {
  const item = await getInventoryItem(token, sku);
  if (!item) {
    return { ok: false, error: "この出品の商品情報を取得できませんでした（eBay側で削除/別管理の可能性）。再出品し直してください。" };
  }
  const prevProduct = (item.product as Record<string, unknown>) ?? {};
  const prevAspects = (prevProduct.aspects as Record<string, string[]>) ?? {};
  // 既存のItem Specificsを土台に、渡された項目（製造国=Japan・確信できるブランド）だけ上書きする。
  const aspects: Record<string, string[]> = { ...prevAspects };
  for (const [k, v] of Object.entries(fields.aspects ?? {})) {
    if (k && v && v.trim()) aspects[k] = [v.trim()];
  }
  const product: Record<string, unknown> = { ...prevProduct, aspects };
  if (fields.title && fields.title.trim()) product.title = fields.title.trim().slice(0, 80);
  if (fields.descriptionHtml) product.description = fields.descriptionHtml;
  const body: Record<string, unknown> = { product };
  // 不変項目はGET値をそのまま再送（PUTは全置換のため欠かすと消える）。
  if (item.availability != null) body.availability = item.availability;
  if (item.condition != null) body.condition = item.condition;
  if (item.conditionDescription != null) body.conditionDescription = item.conditionDescription;
  if (item.packageWeightAndSize != null) body.packageWeightAndSize = item.packageWeightAndSize;
  const r = await ebayFetch(token, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, body);
  return { ok: r.ok, error: r.error };
}

// 公開中の出品の「説明文」をオファー側にも反映する。
// publish時に offer.listingDescription を設定しているため、在庫アイテムの product.description だけを変えても
// View Item の説明が変わらない（eBay仕様: 両方あれば offer.listingDescription が優先）。
// GETしたオファーをそのまま戻し、説明だけ差し替えてPUTする（価格/数量/ポリシー/カテゴリは保持＝変えない）。
// オファーが無い（未公開）なら変更不要＝成功扱い（在庫アイテム側の説明で足りる）。
export async function updateOfferListingDescription(
  token: string,
  sku: string,
  descriptionHtml: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await ebayFetch(
    token,
    "GET",
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`
  );
  const offer = (r.data as { offers?: Record<string, unknown>[] } | null)?.offers?.[0];
  if (!offer?.offerId) return { ok: true }; // 未公開（オファー無し）
  const offerId = offer.offerId as string;
  const body: Record<string, unknown> = { ...offer, listingDescription: descriptionHtml };
  // PUTが受け付けない読み取り専用フィールドは除く。
  delete body.offerId;
  delete body.listing;
  delete body.status;
  delete body.warnings;
  const put = await ebayFetch(token, "PUT", `/sell/inventory/v1/offer/${offerId}`, body);
  // 変更なし(20403 same as in the system)＝既に同内容＝成功扱い。
  if (put.ok || isNoOpUpdate(put.error)) return { ok: true };
  return { ok: false, error: put.error };
}
