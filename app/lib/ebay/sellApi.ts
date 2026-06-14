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
interface OrdersResponse {
  orders?: {
    creationDate?: string;
    lineItems?: { sku?: string; lineItemCost?: { value?: string } }[];
  }[];
}

export interface SoldItem {
  sku: string; // rr-* の SKU
  soldUsd: number; // 売値(USD)
  soldAt: string; // 注文日(ISO)
}
export interface SoldItemsResult {
  ok: boolean;
  needsReconnect: boolean; // sell.fulfillment 未付与（再連携が必要）
  partial: boolean; // ページネーション途中でeBayエラー＝全件読めていない（次回も同期が必要）
  items: SoldItem[];
}

// 売れた注文のうちアプリ出品(SKU=rr-*)の品を、売値・注文日つきで返す（同一SKUは1回）。
// 全ページを読み切れたときだけ partial:false。途中でeBayエラーになった場合は、
// それまでに拾えた items は返しつつ partial:true を立て、呼び出し側で「同期未完了」として扱わせる。
export async function getSoldItems(token: string): Promise<SoldItemsResult> {
  const items: SoldItem[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let reachedEnd = false;
  for (let pageReq = 0; pageReq < 5; pageReq++) {
    const r = await ebayGet<OrdersResponse>(
      token,
      `/sell/fulfillment/v1/order?limit=200&offset=${offset}`
    );
    // 401/403：初回ページのみスコープ未付与＝再連携。途中ページは一時失敗とみなし、
    // 既に拾えた items は温存して partial:true（次回も同期させ取りこぼさない）。
    if (r.status === 401 || r.status === 403) {
      if (pageReq === 0) return { ok: false, needsReconnect: true, partial: true, items: [] };
      return { ok: false, needsReconnect: false, partial: true, items };
    }
    if (!r.ok || !r.data) {
      // ページ途中での失敗：拾えた分は返すが「全件読めていない(partial)」を立てる。
      // ok は誤って成功扱いしないよう false（同期ゲートを進めない）。
      return { ok: false, needsReconnect: false, partial: true, items };
    }
    const orders = r.data.orders ?? [];
    for (const o of orders) {
      for (const li of o.lineItems ?? []) {
        if (isAppSku(li.sku) && !seen.has(li.sku as string)) {
          seen.add(li.sku as string);
          items.push({
            sku: li.sku as string,
            soldUsd: Number(li.lineItemCost?.value ?? 0) || 0,
            soldAt: o.creationDate ?? "",
          });
        }
      }
    }
    if (orders.length < 200) {
      reachedEnd = true;
      break; // 最終ページまで読み切れた
    }
    offset += 200;
  }
  // 上限(5ページ=1000注文)に達して打ち切った場合は partial:true（同期未完了として次回も読む）
  return { ok: true, needsReconnect: false, partial: !reachedEnd, items };
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

// 同名ポリシーが既に存在するエラーは成功扱い（再実行で誤って失敗表示しないため）。
// ただし「does not exist」系（本物の作成失敗）は素通りさせない（"exist" の過剰一致を防ぐ）。
function okIfExists(r: EbayPostResult): EbayPostResult {
  if (r.ok) return r;
  const msg = r.error ?? "";
  if (/does not exist|non-?existent/i.test(msg)) return r;
  if (/already|duplicate/i.test(msg)) return { ok: true, status: r.status };
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
  const body = {
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
  };
  const post = await ebayPost(token, "/sell/account/v1/fulfillment_policy", body);
  if (post.ok) return post;
  // 配送ポリシー名はサイズ固定のため再実行で同名衝突する。送料・発送日数は変わり得るので
  // 「重複なら更新(PUT)」する。okIfExists で握りつぶすと送料変更が無音で無効化されてしまう。
  if (!/already|exist|duplicate/i.test(post.error ?? "")) return post;
  const list = await ebayGet<{ fulfillmentPolicies?: { fulfillmentPolicyId?: string; name?: string }[] }>(
    token,
    `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`
  );
  const id = list.data?.fulfillmentPolicies?.find((p) => p.name === name)?.fulfillmentPolicyId;
  if (!id) return post; // 既存IDを特定できなければ元のエラーを返す
  const put = await ebayWrite(token, "PUT", `/sell/account/v1/fulfillment_policy/${id}`, body);
  return put.ok ? { ok: true, status: put.status, id } : { ok: false, status: put.status, error: put.error };
}
