import { NextResponse } from "next/server";
import { sanitizeRefCode, recordReferralClick, REF_COOKIE, COOKIE_MAX_AGE } from "../../lib/referralServer";

// インフルエンサーに渡す紹介リンク: https://www.yushutsu-fukugyo.com/r/{code}
// クリックを計上し、紹介コードを cookie に保存(90日)してからトップへリダイレクト。
// その後この端末で新規登録が起きると ref として成果に計上される。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = sanitizeRefCode(raw);
  const res = NextResponse.redirect(new URL("/", req.url));
  if (code) {
    await recordReferralClick(code);
    res.cookies.set(REF_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
  return res;
}
