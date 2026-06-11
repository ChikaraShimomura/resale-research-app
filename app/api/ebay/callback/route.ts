import { cookies } from "next/headers";
import { exchangeCode, EBAY_SCOPES } from "../../../lib/ebay/oauth";
import { saveTokens, tokenEncryptionReady } from "../../../lib/ebay/tokens";

// eBay 同意後のコールバック: state 検証 → code をトークン交換 → 暗号化して KV 保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(req: Request, status: "connected" | "error"): Response {
  return Response.redirect(new URL(`/search?ebay=${status}`, req.url), 302);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const savedState = jar.get("ebay_oauth_state")?.value;
  jar.delete("ebay_oauth_state");

  // CSRF: state 一致を必須に
  if (!code || !state || !savedState || state !== savedState) return back(req, "error");
  if (!tokenEncryptionReady()) return back(req, "error"); // 暗号鍵未設定なら保存しない

  // 暫定アクター識別子（middleware が発行するデバイス cookie）。本来の認証導入時に userId へ。
  const conn = jar.get("rr_did")?.value;
  if (!conn) return back(req, "error");

  const data = await exchangeCode(code);
  if (!data?.access_token || !data?.refresh_token) return back(req, "error");

  const ok = await saveTokens(conn, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: Date.now() + (data.expires_in - 60) * 1000,
    refreshExpiresAt: Date.now() + ((data.refresh_token_expires_in ?? 47_304_000) - 60) * 1000,
    scopes: EBAY_SCOPES,
  });

  return back(req, ok ? "connected" : "error");
}
