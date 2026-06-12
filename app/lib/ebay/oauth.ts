// eBay OAuth (Authorization Code grant) — サーバー専用。
// client_secret(=Cert ID) を扱うため絶対にクライアントへ import しないこと。
// 必要な env: EBAY_APP_ID, EBAY_CLIENT_SECRET(Cert ID), EBAY_RUNAME, 任意 EBAY_ENV(sandbox|production)

const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const APP_ID = process.env.EBAY_APP_ID;
const CERT_ID = process.env.EBAY_CLIENT_SECRET;
const RUNAME = process.env.EBAY_RUNAME;

const BASE =
  ENV === "sandbox"
    ? { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" }
    : { auth: "https://auth.ebay.com", api: "https://api.ebay.com" };

// 基本スコープ（承認不要）。createItemDraft 用の sell.item.draft は
// eBay の Limited Release 承認が下りたら下に追加する。
// sell.fulfillment は「自分が売れた注文(getOrders)」の読み取りに必要（売却の自動検知用）。
// ※ buy.marketplace.insights は Limited Release のため承認が下りるまで絶対に足さないこと。
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");

export function ebayConfigured(): boolean {
  return Boolean(APP_ID && CERT_ID && RUNAME);
}

export function getAuthorizeUrl(state: string): string | null {
  if (!ebayConfigured()) return null;
  const p = new URLSearchParams({
    client_id: APP_ID!,
    redirect_uri: RUNAME!, // eBay は RuName を redirect_uri として受け取る
    response_type: "code",
    scope: EBAY_SCOPES,
    state,
    prompt: "login",
  });
  return `${BASE.auth}/oauth2/authorize?${p.toString()}`;
}

export interface EbayTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  token_type?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<EbayTokenResponse | null> {
  if (!ebayConfigured()) return null;
  const basic = Buffer.from(`${APP_ID}:${CERT_ID}`).toString("base64");
  try {
    const res = await fetch(`${BASE.api}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[eBay OAuth] token HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as EbayTokenResponse;
  } catch (e) {
    console.error(`[eBay OAuth] token error: ${(e as Error).message}`);
    return null;
  }
}

export function exchangeCode(code: string): Promise<EbayTokenResponse | null> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: RUNAME!,
    })
  );
}

export function refreshAccessToken(refreshToken: string): Promise<EbayTokenResponse | null> {
  // scope は省略する。明示すると「同意済みより広いスコープ」を要求した形になり、
  // スコープ追加(sell.fulfillment)より前に連携した既存トークンの更新が invalid_scope で壊れる。
  // 省略すれば eBay は元の同意スコープでトークンを返す（新規連携は連携時に新スコープを同意済み）。
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

// アプリトークン（client_credentials）。Taxonomy API（カテゴリ/Item Specifics）など
// ユーザー同意不要の公開APIに使う。メモリにキャッシュ（有効期限まで再利用）。
let appTokenCache: { token: string; exp: number } | null = null;

export async function getAppAccessToken(): Promise<string | null> {
  if (appTokenCache && Date.now() < appTokenCache.exp) return appTokenCache.token;
  const r = await tokenRequest(
    new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    })
  );
  if (!r?.access_token) return null;
  appTokenCache = { token: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
  return r.access_token;
}
