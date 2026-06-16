"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signUpAction } from "../auth/actions";
import type { AuthState } from "../auth/types";

const initial: AuthState = {};
const field =
  "w-full h-11 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#BF0000]/30 focus:border-[#BF0000]";

export default function RegisterPage() {
  const [state, action, pending] = useActionState(signUpAction, initial);
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">新規登録</h1>
        <p className="text-sm text-gray-500 mb-5">メールアドレスとパスワードだけ。利益の記録が端末を跨いで残せます。</p>
        {state.message ? (
          <>
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">{state.message}</div>
            <p className="mt-3 text-[12px] text-gray-500 leading-relaxed">
              メールが届かないときは<b>迷惑メールフォルダ</b>をご確認ください。数分待っても届かなければ、もう一度登録をお試しください。
            </p>
          </>
        ) : (
          <form action={action} className="space-y-3">
            <input name="email" type="email" required placeholder="メールアドレス" autoComplete="email" className={field} />
            <input name="password" type="password" required minLength={8} placeholder="パスワード（8文字以上）" autoComplete="new-password" className={field} />
            {state.error && <p className="text-sm text-[#BF0000]">{state.error}</p>}
            <button type="submit" disabled={pending} className="w-full h-11 rounded-lg bg-[#BF0000] text-white text-sm font-bold disabled:opacity-60">
              {pending ? "登録中..." : "登録する"}
            </button>
          </form>
        )}
        <div className="mt-4 text-sm text-center">
          <Link href="/login" className="text-[#BF0000] font-medium">すでにアカウントをお持ちの方</Link>
        </div>
        <Link href="/search" className="block text-center mt-4 text-xs text-gray-400">登録せずに使う（ゲスト）</Link>
      </div>
    </main>
  );
}
