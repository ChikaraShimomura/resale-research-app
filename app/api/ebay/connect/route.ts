import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getAuthorizeUrl, ebayConfigured } from "../../../lib/ebay/oauth";

// eBay 連携の開始: 同意画面へリダイレクト。state(CSRF) を HttpOnly cookie に保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!ebayConfigured()) {
    return new Response("eBay OAuth 未設定（EBAY_APP_ID / EBAY_CLIENT_SECRET / EBAY_RUNAME）", { status: 503 });
  }
  const state = crypto.randomBytes(16).toString("hex");
  const url = getAuthorizeUrl(state);
  if (!url) return new Response("internal error", { status: 500 });

  const jar = await cookies();
  jar.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return Response.redirect(url, 302);
}
