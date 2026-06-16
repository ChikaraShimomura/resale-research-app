import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getAuthorizeUrl, ebayConfigured } from "../../../lib/ebay/oauth";

// eBay 連携の開始: 同意画面へリダイレクト。state(CSRF) を HttpOnly cookie に保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!ebayConfigured()) {
    return new Response("eBay OAuth 未設定（EBAY_APP_ID / EBAY_CLIENT_SECRET / EBAY_RUNAME）", { status: 503 });
  }
  const state = crypto.randomBytes(16).toString("hex");
  const url = getAuthorizeUrl(state);
  if (!url) return new Response("internal error", { status: 500 });

  const jar = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  jar.set("ebay_oauth_state", state, { ...cookieOpts, maxAge: 600 });
  // 出品から来た連携(?list=商品ID)を OAuth 往復で失わないよう cookie に退避（callback が復元）。
  // アプリ内ブラウザ(X/LINE)は storage が揮発しやすいため、storage 復元より確実。
  const list = new URL(req.url).searchParams.get("list");
  if (list) jar.set("ebay_list_after", list, { ...cookieOpts, maxAge: 900 });
  return Response.redirect(url, 302);
}
