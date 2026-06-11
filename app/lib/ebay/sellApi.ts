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
