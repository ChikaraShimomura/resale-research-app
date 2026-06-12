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

// 在庫ロケーション（Inventory API で出品する際の merchantLocationKey の元）。
export async function countInventoryLocations(token: string): Promise<number> {
  const r = await ebayGet<{ locations?: unknown[]; total?: number }>(
    token,
    `/sell/inventory/v1/location`
  );
  return r.data?.locations?.length ?? r.data?.total ?? 0;
}

// ── 売却の自動検知（Fulfillment API getOrders） ──
// アプリ経由でeBay出品した商品は SKU が "rr-{商品ID}" になっている。
// 自分の売れた注文を読み、その SKU から商品IDを取り出して「売れた商品」を特定する。
// 必要スコープ: sell.fulfillment（未付与＝旧トークンなら needsReconnect を立てる）。

// アプリが出品時に付ける SKU の接頭辞。create-draft と sold-sync で共有する。
export const APP_SKU_PREFIX = "rr-";

export function productIdFromSku(sku: string | undefined): string | null {
  if (!sku) return null;
  return sku.startsWith(APP_SKU_PREFIX) ? sku.slice(APP_SKU_PREFIX.length) : null;
}

interface OrdersResponse {
  orders?: {
    lineItems?: { sku?: string }[];
  }[];
}

export interface SoldSyncResult {
  ok: boolean;
  needsReconnect: boolean; // sell.fulfillment 未付与（再連携が必要）
  ids: string[]; // 売れたアプリ商品の id（重複排除済み）
}

// 直近の売れた注文を取得し、アプリ出品(SKU=rr-*)の商品IDだけを返す。
export async function getSoldProductIds(token: string): Promise<SoldSyncResult> {
  // creationdate フィルタで直近のみ。limit=200/ページを最大数ページ辿る。
  const ids = new Set<string>();
  let offset = 0;
  for (let pageReq = 0; pageReq < 5; pageReq++) {
    const r = await ebayGet<OrdersResponse>(
      token,
      `/sell/fulfillment/v1/order?limit=200&offset=${offset}`
    );
    // 401/403 はスコープ未付与（旧トークン）→ 再連携が必要
    if (r.status === 401 || r.status === 403) {
      return { ok: false, needsReconnect: true, ids: [] };
    }
    if (!r.ok || !r.data) {
      // 1ページ目で失敗ならエラー、途中失敗ならそこまでの結果を返す
      return { ok: ids.size > 0, needsReconnect: false, ids: [...ids] };
    }
    const orders = r.data.orders ?? [];
    for (const o of orders) {
      for (const li of o.lineItems ?? []) {
        const pid = productIdFromSku(li.sku);
        if (pid) ids.add(pid);
      }
    }
    if (orders.length < 200) break; // 最終ページ
    offset += 200;
  }
  return { ok: true, needsReconnect: false, ids: [...ids] };
}

// ── 書き込み系（下書き作成の土台） ──
interface EbayWriteResult {
  ok: boolean;
  status: number;
  error?: string;
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
      const j = (await res.json()) as { errors?: { message?: string }[] };
      if (j?.errors?.[0]?.message) error = j.errors[0].message;
    } catch {
      /* noop */
    }
    return { ok: false, status: res.status, error };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
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

// 既存を削除してから作成（住所更新に対応・冪等）。初回はDELETEが404でも問題なし。
export async function upsertInventoryLocation(
  token: string,
  addr: ShipFromAddress
): Promise<EbayWriteResult> {
  await ebayWrite(token, "DELETE", `/sell/inventory/v1/location/${SHIP_FROM_LOCATION_KEY}`);
  return ebayWrite(token, "POST", `/sell/inventory/v1/location/${SHIP_FROM_LOCATION_KEY}`, {
    location: { address: { ...addr } },
    name: "Japan ship-from",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  });
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
    const data = (await res.json().catch(() => null)) as
      | {
          errors?: {
            errorId?: number;
            message?: string;
            longMessage?: string;
            parameters?: { name?: string; value?: string }[];
          }[];
          [k: string]: unknown;
        }
      | null;
    if (res.ok || res.status === 201 || res.status === 204) {
      const id =
        (data?.paymentPolicyId as string) ??
        (data?.returnPolicyId as string) ??
        (data?.fulfillmentPolicyId as string) ??
        undefined;
      return { ok: true, status: res.status, id };
    }
    // eBayの詳細エラー（longMessage + 該当フィールド + errorId）を組み立てる
    const e0 = data?.errors?.[0];
    let error: string;
    if (e0) {
      const params = (e0.parameters ?? [])
        .map((p) => `${p.name ?? ""}=${p.value ?? ""}`)
        .filter((s) => s !== "=")
        .join(", ");
      error = [e0.longMessage || e0.message, params && `(${params})`, e0.errorId && `#${e0.errorId}`]
        .filter(Boolean)
        .join(" ");
    } else {
      error = `HTTP ${res.status}`;
    }
    return { ok: false, status: res.status, error };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

// 同名ポリシーが既に存在するエラーは成功扱い（再実行で誤って失敗表示しないため）
function okIfExists(r: EbayPostResult): EbayPostResult {
  if (r.ok) return r;
  if (/already|exist|duplicate/i.test(r.error ?? "")) return { ok: true, status: r.status };
  return r;
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

// 返品不可ポリシー
export async function createNoReturnPolicy(token: string, marketplace: string): Promise<EbayPostResult> {
  return okIfExists(
    await ebayPost(token, "/sell/account/v1/return_policy", {
      name: "No returns",
      marketplaceId: marketplace,
      categoryTypes: CATEGORY_TYPES,
      returnsAccepted: false,
    })
  );
}

// サイズ別の一律・国際送料の配送ポリシー（1サイズ＝1ポリシー）。
export async function createFlatIntlFulfillmentPolicy(
  token: string,
  marketplace: string,
  name: string,
  shippingCostUsd: string,
  handlingDays: number
): Promise<EbayPostResult> {
  return okIfExists(
    await ebayPost(token, "/sell/account/v1/fulfillment_policy", {
    name,
    marketplaceId: marketplace,
    categoryTypes: CATEGORY_TYPES,
    handlingTime: { value: handlingDays, unit: "DAY" },
    shippingOptions: [
      {
        // 国内（マーケット国=米国）向け。これが無いと LOGISTICS_INFO_IS_MISSING になる。
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingServiceCode: "USPSPriority",
            shippingCost: { value: shippingCostUsd, currency: "USD" },
          },
        ],
      },
      {
        // それ以外の国向け（国際）
        optionType: "INTERNATIONAL",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            sortOrder: 1,
            shippingServiceCode: "USPSPriorityMailInternational",
            shippingCost: { value: shippingCostUsd, currency: "USD" },
            shipToLocations: { regionIncluded: [{ regionName: "Worldwide" }] },
          },
        ],
      },
    ],
    })
  );
}
