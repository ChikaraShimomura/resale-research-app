import { cookies } from "next/headers";
import { getActorId } from "../../../lib/auth/actor";
import { exchangeCode, EBAY_SCOPES } from "../../../lib/ebay/oauth";
import { saveTokens, tokenEncryptionReady } from "../../../lib/ebay/tokens";

// eBay 同意後のコールバック: state 検証 → code をトークン交換 → 暗号化して KV 保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 出品から来た連携なら ?list=<商品ID> を復元して eBayアカウント設定画面に渡し、出品対象に戻れるようにする。
// 戻り先は eBay 連携UI(EbayConnect/EbayListingSetup)を載せた /settings/ebay（輸出ラボ自体の設定 /settings とは分離）。
function back(req: Request, status: "connected" | "error", list?: string | null): Response {
  const u = new URL(`/settings/ebay?ebay=${status}`, req.url);
  if (list) u.searchParams.set("list", list);
  return Response.redirect(u, 302);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const savedState = jar.get("ebay_oauth_state")?.value;
  const listAfter = jar.get("ebay_list_after")?.value ?? null; // connect で退避した出品対象
  jar.delete("ebay_oauth_state");
  jar.delete("ebay_list_after");

  // CSRF: state 一致を必須に
  if (!code || !state || !savedState || state !== savedState) return back(req, "error", listAfter);
  if (!tokenEncryptionReady()) return back(req, "error", listAfter); // 暗号鍵未設定なら保存しない

  // 暫定アクター識別子（middleware が発行するデバイス cookie）。本来の認証導入時に userId へ。
  const conn = await getActorId();
  if (!conn) return back(req, "error", listAfter);

  const data = await exchangeCode(code);
  if (!data?.access_token || !data?.refresh_token) return back(req, "error", listAfter);

  const ok = await saveTokens(conn, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: Date.now() + (data.expires_in - 60) * 1000,
    refreshExpiresAt: Date.now() + ((data.refresh_token_expires_in ?? 47_304_000) - 60) * 1000,
    scopes: EBAY_SCOPES,
  });

  return back(req, ok ? "connected" : "error", listAfter);
}
