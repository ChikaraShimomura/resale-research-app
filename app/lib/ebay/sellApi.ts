// eBay Sell API クライアント（サーバー専用・読み取り中心）。
// アクセストークンは getValidAccessToken() で取得したものを渡す。
// まずは「出品準備チェック」用の参照系のみ。下書き作成(write)は別途・要確認のうえ追加する。

const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const API = ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

interface EbayGetResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

async function ebayGet<T>(token: string, path: string): Promise<EbayGetResult<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // Inventory API は Accept-Language を見るため付与（listing.ts と挙動を統一）
        "Accept-Language": "en-US",
      },
      signal: AbortSignal.timeout(15000),
    });
    const data = res.ok ? ((await res.json()) as T) : null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ビジネスポリシー（marketplace単位）。未オプトイン時はエラーになるため 0 件扱い。
export async function countFulfillmentPolicies(token: string, marketplace: string): Promise<number> {
  const r = await ebayGet<{ fulfillmentPolicies?: unknown[]; total?: number }>(
    token,
    `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`
  );
  return r.data?.fulfillmentPolicies?.length ?? 0;
}

export async function countPaymentPolicies(token: string, marketplace: string): Promise<number> {
  const r = await ebayGet<{ paymentPolicies?: unknown[]; total?: number }>(
    token,
    `/sell/account/v1/payment_policy?marketplace_id=${marketplace}`
  );
  return r.data?.paymentPolicies?.length ?? 0;
}

export async function countReturnPolicies(token: string, marketplace: string): Promise<number> {
  const r = await ebayGet<{ returnPolicies?: unknown[]; total?: number }>(
    token,
    `/sell/account/v1/return_policy?marketplace_id=${marketplace}`
  );
  return r.data?.returnPolicies?.length ?? 0;
}

// ── アプリ出品の SKU（売却検知の鍵） ──
// アプリ経由でeBay出品した商品は SKU を "rr-{サニタイズ済み商品ID}" にする。
// 楽天 itemCode は "shop:code" のようにコロンを含み eBay SKU(英数字+ハイフン+_/50字)で弾かれるため、
// SKUはサニタイズし、SKU→商品ID の対応表を別途KVに保存して逆引きする（route側で実施）。
export const APP_SKU_PREFIX = "rr-";

export function isAppSku(sku?: string): boolean {
  return !!sku && sku.startsWith(APP_SKU_PREFIX);
}

// 商品ID → eBay SKU。英数字・ハイフン・アンダースコア以外をハイフンに置換し50字以内に丸める。
export function skuForProduct(productId: string): string {
  const safe = productId.replace(/[^A-Za-z0-9_-]/g, "-");
  return (APP_SKU_PREFIX + safe).slice(0, 50);
}

// ── 売却の自動検知（Fulfillment API getOrders） ──
// 自分の売れた注文を読み、アプリ出品(SKU=rr-*)の SKU だけを返す。商品IDへの変換は対応表で route 側が行う。
// 必要スコープ: sell.fulfillment（未付与＝旧トークンなら needsReconnect を立てる）。
// Fulfillment Order の生レスポンス（必要分のみ・全フィールド任意）。
interface OrdersResponse {
  orders?: {
    orderId?: string;
    creationDate?: string;
    orderFulfillmentStatus?: string; // NOT_STARTED / IN_PROGRESS / FULFILLED
    cancelStatus?: { cancelState?: string }; // NONE_REQUESTED / CANCEL_REQUESTED / CANCELED ...
    buyer?: { username?: string };
    fulfillmentStartInstructions?: {
      shippingStep?: {
        shipTo?: {
          fullName?: string;
          contactAddress?: {
            addressLine1?: string; addressLine2?: string; city?: string;
            stateOrProvince?: string; postalCode?: string; countryCode?: string;
          };
        };
      };
    }[];
    lineItems?: {
      lineItemId?: string;
      sku?: string;
      title?: string;
      quantity?: number;
      lineItemCost?: { value?: string };
      lineItemFulfillmentStatus?: string;
      lineItemFulfillmentInstructions?: { shipByDate?: string }; // 発送期限(handling)
    }[];
  }[];
}

export interface SoldItem {
  sku: string; // rr-* の SKU
  soldUsd: number; // 売値(USD)
  soldAt: string; // 注文日(ISO)
}

// ── 注文(Order)エンティティ（配送管理の土台）──
// getOrders が返す情報のうち、これまで捨てていた buyer住所/発送期限/orderId/lineItem/状態 を正規化して保持。
// 追跡番号の書き戻し(②)・発送期限カウントダウン(③)・欠品リカバリ(⑤)が全部これに乗る。
export interface EbayShipTo {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
}
export interface EbayOrderLine {
  lineItemId: string;
  sku: string; // rr-*
  title?: string;
  quantity?: number;
  soldUsd: number;
  shipByDate?: string; // 発送期限（これを過ぎると late shipment defect）
  fulfillmentStatus?: string; // lineItemFulfillmentStatus
}
export interface EbayOrder {
  orderId: string;
  creationDate?: string;
  fulfillmentStatus?: string; // orderFulfillmentStatus
  buyerUsername?: string;
  shipTo?: EbayShipTo;
  shipByDate?: string; // 注文内ラインの最早 shipByDate（カウントダウン表示用）
  cancelled?: boolean; // eBay側でキャンセル(申請含む)＝発送不要
  lines: EbayOrderLine[]; // アプリ出品(rr-*)のラインのみ
}

export interface SoldItemsResult {
  ok: boolean;
  needsReconnect: boolean; // sell.fulfillment 未付与（再連携が必要）
  partial: boolean; // ページネーション途中でeBayエラー＝全件読めていない（次回も同期が必要）
  items: SoldItem[]; // 売却検知用（同一SKUは1回）
  orders: EbayOrder[]; // 注文エンティティ（orderId 単位・アプリ出品ラインを含む注文）
}

// 売れた注文のうちアプリ出品(SKU=rr-*)の品を、売値・注文日つきで返す（同一SKUは1回）＝売却検知用 items。
// あわせて orderId 単位の正規化注文 orders（買い手住所/発送期限/状態つき）も返す＝配送管理の土台。
// 全ページを読み切れたときだけ partial:false。途中でeBayエラーになった場合は、
// それまでに拾えた items/orders は返しつつ partial:true を立て、呼び出し側で「同期未完了」として扱わせる。
export async function getSoldItems(token: string): Promise<SoldItemsResult> {
  const items: SoldItem[] = [];
  const ordersOut: EbayOrder[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let reachedEnd = false;
  for (let pageReq = 0; pageReq < 5; pageReq++) {
    const r = await ebayGet<OrdersResponse>(
      token,
      `/sell/fulfillment/v1/order?limit=200&offset=${offset}`
    );
    // 401/403：初回ページのみスコープ未付与＝再連携。途中ページは一時失敗とみなし、
    // 既に拾えた分は温存して partial:true（次回も同期させ取りこぼさない）。
    if (r.status === 401 || r.status === 403) {
      if (pageReq === 0) return { ok: false, needsReconnect: true, partial: true, items: [], orders: [] };
      return { ok: false, needsReconnect: false, partial: true, items, orders: ordersOut };
    }
    if (!r.ok || !r.data) {
      // ページ途中での失敗：拾えた分は返すが「全件読めていない(partial)」を立てる。
      // ok は誤って成功扱いしないよう false（同期ゲートを進めない）。
      return { ok: false, needsReconnect: false, partial: true, items, orders: ordersOut };
    }
    const orders = r.data.orders ?? [];
    for (const o of orders) {
      const lines: EbayOrderLine[] = [];
      for (const li of o.lineItems ?? []) {
        if (!isAppSku(li.sku)) continue;
        const sku = li.sku as string;
        const soldUsd = Number(li.lineItemCost?.value ?? 0) || 0;
        lines.push({
          lineItemId: li.lineItemId ?? "",
          sku,
          title: li.title,
          quantity: typeof li.quantity === "number" ? li.quantity : undefined,
          soldUsd,
          shipByDate: li.lineItemFulfillmentInstructions?.shipByDate,
          fulfillmentStatus: li.lineItemFulfillmentStatus,
        });
        // 売却検知用 items は同一SKUを1回だけ。
        if (!seen.has(sku)) {
          seen.add(sku);
          items.push({ sku, soldUsd, soldAt: o.creationDate ?? "" });
        }
      }
      // アプリ出品ラインを含む注文だけ Order として保持。
      if (lines.length > 0 && o.orderId) {
        const shipTo = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
        const ca = shipTo?.contactAddress;
        const shipByDate = lines.map((l) => l.shipByDate).filter(Boolean).sort()[0]; // 最早の期限
        ordersOut.push({
          orderId: o.orderId,
          creationDate: o.creationDate,
          fulfillmentStatus: o.orderFulfillmentStatus,
          buyerUsername: o.buyer?.username,
          shipTo: shipTo
            ? {
                name: shipTo.fullName,
                addressLine1: ca?.addressLine1,
                addressLine2: ca?.addressLine2,
                city: ca?.city,
                stateOrProvince: ca?.stateOrProvince,
                postalCode: ca?.postalCode,
                countryCode: ca?.countryCode,
              }
            : undefined,
          shipByDate,
          cancelled: !!o.cancelStatus?.cancelState && o.cancelStatus.cancelState !== "NONE_REQUESTED",
          lines,
        });
      }
    }
    if (orders.length < 200) {
      reachedEnd = true;
      break; // 最終ページまで読み切れた
    }
    offset += 200;
  }
  // 上限(5ページ=1000注文)に達して打ち切った場合は partial:true（同期未完了として次回も読む）
  return { ok: true, needsReconnect: false, partial: !reachedEnd, items, orders: ordersOut };
}

// ── 書き込み系（下書き作成の土台） ──
interface EbayWriteResult {
  ok: boolean;
  status: number;
  error?: string;
}

// eBayのエラーレスポンスを「longMessage + 該当フィールド(parameters) + #errorId」の1行に整形する。
// ⚠️ message だけだと "Invalid ." のように"何が"invalidかが落ちて原因が追えない（実害: 配送ポリシーPUTの失敗が
//    "Invalid ."としか出ず診断不能だった）。longMessage と parameters（不正フィールド名/値）は必ず残す。POST/PUT/DELETE 共通。
interface EbayErrorBody {
  errors?: {
    errorId?: number;
    message?: string;
    longMessage?: string;
    parameters?: { name?: string; value?: string }[];
  }[];
  [k: string]: unknown;
}
function formatEbayError(data: EbayErrorBody | null, status: number): string {
  const e0 = data?.errors?.[0];
  if (!e0) return `HTTP ${status}`;
  const params = (e0.parameters ?? [])
    .map((p) => `${p.name ?? ""}=${p.value ?? ""}`)
    .filter((s) => s !== "=")
    .join(", ");
  return (
    [e0.longMessage || e0.message, params && `(${params})`, e0.errorId && `#${e0.errorId}`]
      .filter(Boolean)
      .join(" ") || `HTTP ${status}`
  );
}

async function ebayWrite(
  token: string,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<EbayWriteResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true, status: res.status };
    let error = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as EbayErrorBody;
      error = formatEbayError(j, res.status);
    } catch {
      /* noop */
    }
    return { ok: false, status: res.status, error };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

// ② 追跡番号の eBay 書き戻し（createShippingFulfillment）。
// 期限内に登録しないと売上保留の長期化・未着クレーム(INR)の自動敗訴・Top Rated剥奪に直結。
// lineItems は省略＝注文全体を発送済みにする（アプリ出品は単品注文が主）。carrier 未指定は "Other"。
export async function createShippingFulfillment(
  token: string,
  orderId: string,
  opts: { trackingNumber: string; carrier?: string; shippedDate?: string }
): Promise<EbayWriteResult> {
  const body = {
    trackingNumber: opts.trackingNumber,
    shippingCarrierCode: opts.carrier || "Other",
    shippedDate: opts.shippedDate || new Date().toISOString(),
  };
  return ebayWrite(
    token,
    "POST",
    `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,
    body
  );
}

// 発送元（在庫ロケーション）。固定キーで作成し、出品オファーの merchantLocationKey に使う。
export const SHIP_FROM_LOCATION_KEY = "jp-ship-from";

export interface ShipFromAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string; // 2文字コード（例: "JP"）
}

// まずPOSTで作成し、キー重複(409/already exists)の時だけDELETE→POSTで作り直す。
// 破壊的なDELETE先行をやめることで、新住所が無効/一時障害でPOSTが落ちても既存ロケーションを壊さない。
export async function upsertInventoryLocation(
  token: string,
  addr: ShipFromAddress
): Promise<EbayWriteResult> {
  const path = `/sell/inventory/v1/location/${SHIP_FROM_LOCATION_KEY}`;
  const payload = {
    location: { address: { ...addr } },
    name: "Japan ship-from",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };
  const first = await ebayWrite(token, "POST", path, payload);
  if (first.ok) return first;
  // 重複以外の失敗は既存を温存して返す（誤って消さない）
  const isConflict = first.status === 409 || /exist|duplicate|already/i.test(first.error ?? "");
  if (!isConflict) return first;
  const del = await ebayWrite(token, "DELETE", path);
  if (!del.ok && del.status !== 404) return del;
  return ebayWrite(token, "POST", path, payload);
}

// publish が要求する固定キー(jp-ship-from)の実在チェック。readiness 判定に使う
// （任意の1件ではなく、この固定キーが無いと公開が必ず失敗するため）。
export async function hasShipFromLocation(token: string): Promise<boolean> {
  const r = await ebayGet<unknown>(token, `/sell/inventory/v1/location/${SHIP_FROM_LOCATION_KEY}`);
  return r.ok; // 200=存在 / 404=なし。ネット失敗(ok:false)はなし扱い（誤ったOK表示を避ける）
}

// ── ビジネスポリシーの作成（JSONレスポンスとid/errorを返す） ──
interface EbayPostResult {
  ok: boolean;
  status: number;
  id?: string;
  error?: string;
}

async function ebayPost(token: string, path: string, body: unknown): Promise<EbayPostResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => null)) as (EbayErrorBody & {
      paymentPolicyId?: string;
      returnPolicyId?: string;
      fulfillmentPolicyId?: string;
    }) | null;
    if (res.ok || res.status === 201 || res.status === 204) {
      const id =
        (data?.paymentPolicyId as string) ??
        (data?.returnPolicyId as string) ??
        (data?.fulfillmentPolicyId as string) ??
        undefined;
      return { ok: true, status: res.status, id };
    }
    // eBayの詳細エラー（longMessage + 該当フィールド + errorId）を組み立てる（POST/PUT/DELETE 共通）
    return { ok: false, status: res.status, error: formatEbayError(data, res.status) };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

// 同名ポリシーが既に存在するエラーは成功扱い（再実行で誤って失敗表示しないため）。
// ただし「does not exist」系（本物の作成失敗）は素通りさせない（"exist" の過剰一致を防ぐ）。
function okIfExists(r: EbayPostResult): EbayPostResult {
  if (r.ok) return r;
  const msg = r.error ?? "";
  if (/does not exist|non-?existent/i.test(msg)) return r;
  if (/already|duplicate/i.test(msg)) return { ok: true, status: r.status };
  return r;
}

// eBayの「更新内容が現状と完全に同一＝変更なし」(errorId 20403 /
// "...information in the request is the same as in the system")は実質成功。
// 望む設定が既にその通り入っている状態なので、更新(PUT)が変更なしで弾かれても失敗扱いにしない
// （冪等な保存・再実行で「設定済みなのに失敗表示」になるのを防ぐ）。listing.ts の handlingTime 更新でも共用。
export function isNoOpUpdate(error?: string): boolean {
  return (error ?? "").toLowerCase().includes("same as in the system");
}

// Business Policies の有効化。すでに有効なら eBay はエラーを返すが、その場合も成功扱いにする。
export async function optInSellingPolicyManagement(token: string): Promise<EbayPostResult> {
  const r = await ebayPost(token, "/sell/account/v1/program/opt_in", {
    programType: "SELLING_POLICY_MANAGEMENT",
  });
  if (r.ok) return r;
  // 既に有効化済み（その旨のエラー / programType入力エラー #25804）は成功とみなす。
  // 支払い・返品ポリシーが作成できる時点でビジネスポリシーは有効。
  if (/already|opted|25804|programType/i.test(r.error ?? "")) return { ok: true, status: r.status };
  return r;
}

export async function createPaymentPolicy(token: string, marketplace: string): Promise<EbayPostResult> {
  return okIfExists(
    await ebayPost(token, "/sell/account/v1/payment_policy", {
      name: "Default payment",
      marketplaceId: marketplace,
      categoryTypes: CATEGORY_TYPES,
      immediatePay: true,
    })
  );
}

// 返品ポリシー（返品不可 or 返品可）。出品は返品ポリシーの先頭1件を参照するため、
// 既存があれば更新(PUT)・無ければ作成(POST)で「単一ポリシーを上書き」し続ける（設定変更が即反映される）。
export async function createReturnPolicy(
  token: string,
  marketplace: string,
  returnsAccepted: boolean,
  returnDays = 30
): Promise<EbayPostResult> {
  const body: Record<string, unknown> = returnsAccepted
    ? {
        name: "Default return policy",
        marketplaceId: marketplace,
        categoryTypes: CATEGORY_TYPES,
        returnsAccepted: true,
        returnPeriod: { value: returnDays, unit: "DAY" },
        returnShippingCostPayer: "BUYER", // 返送料は買い手負担（出品者の赤字を防ぐ）
        refundMethod: "MONEY_BACK",
      }
    : { name: "Default return policy", marketplaceId: marketplace, categoryTypes: CATEGORY_TYPES, returnsAccepted: false };
  const list = await ebayGet<{ returnPolicies?: { returnPolicyId?: string }[] }>(
    token,
    `/sell/account/v1/return_policy?marketplace_id=${marketplace}`
  );
  const existingId = list.data?.returnPolicies?.[0]?.returnPolicyId;
  if (existingId) {
    const put = await ebayWrite(token, "PUT", `/sell/account/v1/return_policy/${existingId}`, body);
    // 変更なし(20403 "same as in the system")＝既に望む内容で存在＝成功扱い。
    return put.ok || isNoOpUpdate(put.error) ? { ok: true, status: put.status, id: existingId } : { ok: false, status: put.status, error: put.error };
  }
  return ebayPost(token, "/sell/account/v1/return_policy", body);
}

// 配送ポリシーの共通本体（カテゴリ/発送日数/Global Shipping）。shippingOptions だけ呼び出し側で組む。
// ⚠️ globalShipping は最上位プロパティ。国際発送オプションがあるのに null だと
//    eBay が「Global shipping field is null #20403」でポリシー作成/更新を弾く。
//    自前で国際発送する（INTERNATIONAL を明示構成）ので Global Shipping Program は使わない＝false。
function fulfillmentBody(
  marketplace: string,
  name: string,
  handlingDays: number,
  shippingOptions: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    name,
    marketplaceId: marketplace,
    categoryTypes: CATEGORY_TYPES,
    handlingTime: { value: handlingDays, unit: "DAY" },
    globalShipping: false,
    shippingOptions,
  };
}

// 国際発送オプション（発送先ホワイトリスト）。空（米国のみ）なら null＝INTERNATIONAL を付けない
// （空 regionIncluded は eBay が弾く）。regions は設定画面(EbayPolicySetup)から変更可（規定 AU/GB）。
function intlShippingOption(shippingCostUsd: string, regions: string[]): Record<string, unknown> | null {
  if (regions.length === 0) return null;
  return {
    optionType: "INTERNATIONAL",
    costType: "FLAT_RATE",
    shippingServices: [
      {
        sortOrder: 1,
        shippingServiceCode: "USPSPriorityMailInternational",
        shippingCost: { value: shippingCostUsd, currency: "USD" },
        shipToLocations: { regionIncluded: regions.map((r) => ({ regionName: r })) },
      },
    ],
  };
}

// 配送ポリシーの作成（重複なら更新）。名前は固定のため再実行で同名衝突する→「重複なら更新(PUT)」する。
// okIfExists で握りつぶすと送料・発送日数の変更が無音で無効化されるため、必ず更新する。
async function upsertFulfillmentPolicy(
  token: string,
  marketplace: string,
  name: string,
  body: Record<string, unknown>
): Promise<EbayPostResult> {
  const post = await ebayPost(token, "/sell/account/v1/fulfillment_policy", body);
  if (post.ok) return post;
  if (!/already|exist|duplicate/i.test(post.error ?? "")) return post;
  const list = await ebayGet<{ fulfillmentPolicies?: { fulfillmentPolicyId?: string; name?: string }[] }>(
    token,
    `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`
  );
  const id = list.data?.fulfillmentPolicies?.find((p) => p.name === name)?.fulfillmentPolicyId;
  if (!id) return post; // 既存IDを特定できなければ元のエラーを返す
  const put = await ebayWrite(token, "PUT", `/sell/account/v1/fulfillment_policy/${id}`, body);
  // 変更なし(20403 "same as in the system")＝既に望む内容で存在＝成功扱い。
  return put.ok || isNoOpUpdate(put.error) ? { ok: true, status: put.status, id } : { ok: false, status: put.status, error: put.error };
}

// EBAY_US の配送ポリシーで確実に受理される既知の安全圏。Asia等を楽観追加した時に eBay が
// 216347「unsupported destinations for this marketplace」で弾いたら、この集合だけで作り直す（全体失敗を防ぐ）。
const CORE_SAFE_REGIONS = ["AU", "GB", "CA", "DE", "FR"];
function isUnsupportedDestError(err?: string): boolean {
  return /216347|unsupported destination/i.test(err ?? "");
}

// サイズ別の一律・国際送料の配送ポリシー（1サイズ＝1ポリシー）。regions＝国際発送を許可する国コード(規定 AU/GB)。
export async function createFlatIntlFulfillmentPolicy(
  token: string,
  marketplace: string,
  name: string,
  shippingCostUsd: string,
  handlingDays: number,
  regions: string[] = ["AU", "GB"]
): Promise<EbayPostResult> {
  const build = (regs: string[]): Record<string, unknown> => {
    const shippingOptions: Record<string, unknown>[] = [
      {
        // 国内（マーケット国=米国）向け。これが無いと LOGISTICS_INFO_IS_MISSING になる。
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          { sortOrder: 1, shippingServiceCode: "USPSPriority", shippingCost: { value: shippingCostUsd, currency: "USD" } },
        ],
      },
    ];
    const intl = intlShippingOption(shippingCostUsd, regs);
    if (intl) shippingOptions.push(intl);
    return fulfillmentBody(marketplace, name, handlingDays, shippingOptions);
  };
  const res = await upsertFulfillmentPolicy(token, marketplace, name, build(regions));
  if (res.ok || !isUnsupportedDestError(res.error)) return res;
  // 非対応の発送先が混ざっていた → 既知の安全圏だけで作り直す（Asia等の楽観追加でポリシー全体が失敗するのを防ぐ）。
  const safe = regions.filter((r) => CORE_SAFE_REGIONS.includes(r));
  return upsertFulfillmentPolicy(token, marketplace, name, build(safe.length ? safe : CORE_SAFE_REGIONS));
}

// 送料無料の配送ポリシー（送料込み出品＝価格に送料を内包し、買い手の送料は$0）。
// 国内は freeShipping:true（eBayの「送料無料」バッジ＝検索でも有利。先頭の国内サービスにのみ有効・shippingCost不要）。
// 国際は無料フラグが無いので shippingCost=0.00 で無料にする。
// listFulfillmentPolicies は costUsd<0.01 を「無料」と判定するので、これが送料込みトグルの相手になる。
export async function createFreeIntlFulfillmentPolicy(
  token: string,
  marketplace: string,
  name: string,
  handlingDays: number,
  regions: string[] = ["AU", "GB"]
): Promise<EbayPostResult> {
  const build = (regs: string[]): Record<string, unknown> => {
    const shippingOptions: Record<string, unknown>[] = [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [{ sortOrder: 1, shippingServiceCode: "USPSPriority", freeShipping: true }],
      },
    ];
    const intl = intlShippingOption("0.00", regs); // 国際は0.00で無料に
    if (intl) shippingOptions.push(intl);
    return fulfillmentBody(marketplace, name, handlingDays, shippingOptions);
  };
  const res = await upsertFulfillmentPolicy(token, marketplace, name, build(regions));
  if (res.ok || !isUnsupportedDestError(res.error)) return res;
  // 非対応の発送先 → 既知の安全圏だけで作り直す（全体失敗を防ぐ）。
  const safe = regions.filter((r) => CORE_SAFE_REGIONS.includes(r));
  return upsertFulfillmentPolicy(token, marketplace, name, build(safe.length ? safe : CORE_SAFE_REGIONS));
}
