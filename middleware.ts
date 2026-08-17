import { NextResponse, type NextRequest } from "next/server";

const DEVICE_COOKIE = "rr_did";
const isDev = process.env.NODE_ENV !== "production";
// 認証(Supabase)を有効化したとき、ブラウザSupabaseクライアントのfetchをCSPで許可するためのオリジン。
// 未設定なら connect-src は従来どおり（＝認証OFFでCSPは一切変わらない）。
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// 全サイト ログインゲート（会員登録必須）。Supabase が設定済みの時だけ有効化する＝
// 未設定だと登録/ログインが動かないため、ゲートすると全員締め出し（サイト死亡）になる。それを防ぐ安全装置。
const LOGIN_GATE = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
// 未ログインでも到達できる公開パス（認証・法務・PWA資産・紹介リンク）。これ以外は会員登録へ誘導。
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/register" || pathname === "/reset-password") return true;
  if (pathname.startsWith("/auth/") || pathname.startsWith("/r/") || pathname.startsWith("/.well-known/")) return true;
  if (pathname === "/privacy" || pathname === "/terms" || pathname === "/legal" || pathname === "/faq" || pathname === "/sorry") return true;
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") return true;
  // チーム招待の承認ページは未ログインで踏まれ得る（メールのリンク）→ページ内でログイン状態を判定し誘導する。
  if (pathname === "/team/accept") return true;
  // SNS共有カード画像(OG/Twitter)はクローラ(Twitterbot/facebookexternalhit)が未ログインで取得する＝公開必須。
  // ゲートすると /register(HTML)へ307され、X等でカード画像が一切出ない。ネスト経路(例: /ranking/opengraph-image)も許可。
  if (pathname.endsWith("/opengraph-image") || pathname.endsWith("/twitter-image")) return true;
  // 2026-06-29 集客のためマーケ面を再公開（ユーザー判断・2026-06-26「完全会員制」を部分緩和）。
  //   公開＝トップ(集客LP) / ランキング(Top5ぼかし・仕入れ先はゲート) / 料金 / ガイド / プレス（＋上の認証・法務・PWA・OG・/sorry）。
  //   未ログインがここで価値を見て登録へ。詳細・仕入れ先・個人/ツール系は引き続きゲート。
  if (
    pathname === "/" ||
    pathname === "/ranking" ||
    pathname === "/pricing" ||
    pathname === "/guide" ||
    pathname.startsWith("/guide/") ||
    pathname === "/press"
  ) {
    return true;
  }
  // ゲート維持＝カタログ詳細(/catalog)・商品詳細(/product/*)・検索/結果(/search,/results)・
  //   マイページ/商品管理/設定/スタジオ/管理 等（価値の核と個人/ツール系）。未ログインは /register へ。
  return false;
}

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
    `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.upstash.io${SUPABASE_URL ? ` ${SUPABASE_URL}` : ""}${isDev ? " ws: wss:" : ""}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ★サービス終了(2026-07-22 ユーザー指示「輸出ラボを畳む」)：全ページを /closed(終了のお知らせ)へ。
  //   除外＝/closed自身・法務ページ(特商法/プライバシー/規約=閉鎖後も掲示)・/api/*(トレカバンクcron・Stripe webhook(返金/解約イベント)・
  //   eBayアカウント削除通知(開発者アカウントのコンプラ要件)を生かすため。費用が出るAPIは各routeで個別に410/no-op済み)・
  //   /s/*(トレカバンク買取メールの検索ボタン用短縮リダイレクト=個人ツール。サービス機能ではない)。
  //   再開はこの定数を false に。
  const SERVICE_CLOSED = true;
  if (
    SERVICE_CLOSED &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/s/") &&
    pathname !== "/closed" &&
    pathname !== "/legal" && pathname !== "/privacy" && pathname !== "/terms"
  ) {
    return NextResponse.rewrite(new URL("/closed", req.url));
  }

  // メンテナンスモード: 全ページを /sorry に切替（APIと /sorry 自身は除外）。
  // 2026-06-26 中古カタログ移行が一段落したので解除（false）。再度全停止したい時は true / Vercel env MAINTENANCE_MODE=1。
  const MAINTENANCE_REBUILD = false;
  if (
    (MAINTENANCE_REBUILD || process.env.MAINTENANCE_MODE === "1") &&
    !pathname.startsWith("/api/") &&
    pathname !== "/sorry"
  ) {
    return NextResponse.rewrite(new URL("/sorry", req.url));
  }

  // 全サイト ログインゲート：会員登録(=Supabaseセッション)が無ければ /register へ。
  // ページ(HTML)のみ対象。APIは各自で認証/CSRFを処理。Supabase未設定時は LOGIN_GATE=false で無効（ロックアウト防止）。
  if (LOGIN_GATE && !pathname.startsWith("/api/") && !isPublicPath(pathname)) {
    const hasSession = req.cookies.getAll().some((c) => c.name.startsWith("sb-"));
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/register";
      url.search = "?from=gate";
      return NextResponse.redirect(url);
    }
  }

  // API への状態変更リクエストは同一オリジン必須（CSRF / 外部からの spam 対策）。
  // 将来追加する全 /api ミューテーションがこのデフォルトを継承する。
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  // 外部サーバーからのPOSTで同一オリジン検査から除外する経路（各自のトークンで正当性を確認するためCSRF検査は不要）：
  // ・eBayのアカウント削除通知(webhook)　・cron(cron-job.org)からの自動停止(route側でCRON_SECRET検証)。
  const isExternalWebhook =
    pathname === "/api/ebay/account-deletion" ||
    pathname === "/api/ebay/list/auto-stop-cron" ||
    pathname === "/api/internal/ai-brand" || // 画像一致レールのAIプロキシ(Pixel→Vercel・route側でKV鍵SHA-256を検証)
    pathname === "/api/billing/webhook"; // Stripe(署名検証で正当性を確認)
  if (pathname.startsWith("/api/") && isMutation && !isExternalWebhook) {
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

  // 紹介(リファラル)コードの捕捉。/r/{code} 以外に ?ref=code で来た場合のフォールバック。
  // 集計KVはミドルウェアで触らず、cookie だけ保存（クリック計上は /r/ 側）。
  const ref = req.nextUrl.searchParams.get("ref");
  if (ref) {
    const code = ref.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (code) {
      res.cookies.set("rr_ref", code, {
        httpOnly: true,
        secure: !isDev,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 90,
      });
    }
  }

  return res;
}

export const config = {
  // 静的アセット・画像最適化を除外（CSP/cookie 処理は HTML と API のみで十分）
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|mp4|webm|mov|m4v)$).*)",
  ],
};
