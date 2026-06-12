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
