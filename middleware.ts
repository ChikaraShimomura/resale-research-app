import { NextResponse, type NextRequest } from "next/server";

const DEVICE_COOKIE = "rr_did";
const isDev = process.env.NODE_ENV !== "production";

// per-request nonce を使った CSP を組み立てる。
// GA4 はホスト許可（googletagmanager）+ インラインスクリプトに nonce で対応する。
// dev では HMR のため 'unsafe-eval' と websocket を許可する。
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} https://www.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.upstash.io${isDev ? " ws: wss:" : ""}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API への状態変更リクエストは同一オリジン必須（CSRF / 外部からの spam 対策）。
  // 将来追加する全 /api ミューテーションがこのデフォルトを継承する。
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (pathname.startsWith("/api/") && isMutation) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    let ok = false;
    if (origin && host) {
      try { ok = new URL(origin).host === host; } catch { ok = false; }
    }
    if (!ok) return new NextResponse("forbidden", { status: 403 });
  }

  // per-request nonce。layout が読めるようリクエストヘッダにも載せる。
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);

  // SOLD 帰属用のデバイス ID cookie（HttpOnly・推測不能なランダム値）。
  // 本来の認証が入るまでの暫定アクター識別子。
  if (!req.cookies.get(DEVICE_COOKIE)) {
    res.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: !isDev,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return res;
}

export const config = {
  // 静的アセット・画像最適化を除外（CSP/cookie 処理は HTML と API のみで十分）
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
