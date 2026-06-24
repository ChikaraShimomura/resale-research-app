"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { signInAction } from "../auth/actions";
import type { AuthState } from "../auth/types";
import BrandHome from "../components/BrandHome";

const initial: AuthState = {};
const field =
  "w-full h-11 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]";

// URL クエリから、ログインページの初期状態をまとめて導出する（クライアント描画時に一度だけ）。
//  - from        : どのナッジ経由で来たか（登録コンバージョンの帰属用）
//  - next        : ログイン後の遷移先。from=checkout&plan=<id> なら /pricing?resume=<id> で Checkout を自動再開
//  - registerHref: 新規登録へも from/plan を引き継ぎ、帰属を切らさない
const PAID_PLAN_IDS = ["amateur", "veteran", "pro"];
function deriveFromQuery() {
  const empty = { from: "", next: "/search", fromCheckout: false, registerHref: "/register", confirmExpired: false };
  if (typeof window === "undefined") return empty; // SSR/プリレンダ時は既定（クライアントで再評価される）
  const q = new URLSearchParams(window.location.search);
  const from = q.get("from") ?? "";
  const plan = q.get("plan") ?? "";
  const fromCheckout = from === "checkout";
  const next = fromCheckout
    ? PAID_PLAN_IDS.includes(plan)
      ? `/pricing?resume=${plan}`
      : "/pricing"
    : "/search";
  const reg = new URLSearchParams();
  if (from) reg.set("from", from);
  if (plan) reg.set("plan", plan);
  const qs = reg.toString();
  return {
    from,
    next,
    fromCheckout,
    registerHref: qs ? `/register?${qs}` : "/register",
    confirmExpired: q.get("e") === "confirm",
  };
}

export default function LoginPage() {
  const [state, action, pending] = useActionState(signInAction, initial);
  // クエリ由来の値は遅延初期化で一度だけ評価（effect 内 setState のカスケード描画を避ける）。
  const [{ from, next, fromCheckout, registerHref, confirmExpired }] = useState(deriveFromQuery);
  // メール確認リンクの期限切れ等で /login?e=confirm に飛ばされた場合に説明を出す（沈黙させない）。
  const notice = confirmExpired
    ? "確認リンクが期限切れか使用済みです。ログインし直すか、新規登録をやり直してください。"
    : null;
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <BrandHome className="mb-5" />
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#A98B5C]/25 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">ログイン</h1>
        <p className="text-sm text-gray-500 mb-5">サインインで利益ダッシュボードを端末を跨いで保存。</p>
        {fromCheckout && (
          <p className="mb-4 text-[13px] text-[#2D323B] bg-[#A98B5C]/10 border border-[#A98B5C]/30 rounded-lg px-3 py-2.5 leading-relaxed">
            お申し込みにはログインが必要です。ログインすると、そのまま選んだプランの申し込みに戻ります。
          </p>
        )}
        {notice && (
          <p className="mb-4 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-relaxed">
            {notice}
          </p>
        )}
        <form action={action} className="space-y-3">
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="next" value={next} />
          {/* エラー時のみ aria-invalid/aria-describedby を付け、スクリーンリーダーにエラーを関連付ける */}
          <input name="email" type="email" required placeholder="メールアドレス" autoComplete="email" className={field} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "login-error" : undefined} />
          <input name="password" type="password" required placeholder="パスワード" autoComplete="current-password" className={field} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "login-error" : undefined} />
          {state.error && <p id="login-error" role="alert" className="text-sm text-[#2D323B]">{state.error}</p>}
          <button type="submit" disabled={pending} className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold disabled:opacity-60">
            {pending ? "確認中..." : "ログイン"}
          </button>
        </form>
        <div className="flex justify-between mt-4 text-sm">
          <Link href={registerHref} className="text-[#2D323B] font-medium">新規登録</Link>
          <Link href="/reset-password" className="text-gray-500">パスワードを忘れた</Link>
        </div>
      </div>
    </main>
  );
}
