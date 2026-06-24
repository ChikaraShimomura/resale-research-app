"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { signUpAction } from "../auth/actions";
import type { AuthState } from "../auth/types";
import BrandHome from "../components/BrandHome";

const initial: AuthState = {};
const field =
  "w-full h-11 px-3 rounded-lg border border-[#A98B5C]/45 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]";

export default function RegisterPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);
  const [from, setFrom] = useState(""); // どのナッジ経由で来たか（登録コンバージョンの帰属用）
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("from");
    if (f) setFrom(f);
  }, []);
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <BrandHome className="mb-5" />
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-[#A98B5C]/25 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">新規登録</h1>
        <p className="text-sm text-gray-500 mb-5">メールとパスワードだけ。利益の記録が端末を跨いで残る。</p>
        {state.message ? (
          <>
            {/* 確認メッセージ: スクリーンリーダーへ即時通知 */}
            <div role="status" aria-live="polite" className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">{state.message}</div>
            <p className="mt-3 text-[12px] text-gray-500 leading-relaxed">
              届かないときは<b>迷惑メールフォルダ</b>を確認。数分待っても届かなければ再登録を。
            </p>
          </>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="from" value={from} />
            <input name="email" type="email" required placeholder="メールアドレス" autoComplete="email" className={field} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "register-error" : undefined} />
            <input name="password" type="password" required minLength={8} placeholder="パスワード（8文字以上）" autoComplete="new-password" className={field} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "register-error" : undefined} />
            <label className="flex items-start gap-2 text-[11px] text-gray-500 leading-relaxed">
              <input type="checkbox" name="agree" required className="mt-0.5 shrink-0 w-4 h-4 accent-[#2D323B]" />
              <span>
                <Link href="/terms" target="_blank" className="text-[#2D323B] underline">利用規約</Link>と
                <Link href="/privacy" target="_blank" className="text-[#2D323B] underline">プライバシーポリシー</Link>に同意します。
                本サービスは利益を保証しません。eBay・楽天等の各規約遵守、出品の合法性、古物商許可の要否は利用者ご自身でご確認ください。
              </span>
            </label>
            {/* エラー: role=alert で即時読み上げ＋入力に aria-describedby で関連付け */}
            {state.error && <p id="register-error" role="alert" className="text-sm text-[#2D323B]">{state.error}</p>}
            <button type="submit" disabled={pending} className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold disabled:opacity-60">
              {pending ? "登録中..." : "登録する"}
            </button>
          </form>
        )}
        <div className="mt-4 text-sm text-center">
          <Link href="/login" className="text-[#2D323B] font-medium">すでにアカウントをお持ちの方</Link>
        </div>
      </div>
    </main>
  );
}
