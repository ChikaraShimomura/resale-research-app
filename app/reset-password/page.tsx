"use client";
import Link from "next/link";
import { useActionState } from "react";
import { requestResetAction } from "../auth/actions";
import type { AuthState } from "../auth/types";
import BrandHome from "../components/BrandHome";

const initial: AuthState = {};
const field =
  "w-full h-11 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#BF0000]/30 focus:border-[#BF0000]";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(requestResetAction, initial);
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <BrandHome className="mb-5" />
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">パスワード再設定</h1>
        <p className="text-sm text-gray-500 mb-5">登録メールアドレスに再設定リンクを送ります。</p>
        {state.message ? (
          <>
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-800">{state.message}</div>
            <p className="mt-3 text-[12px] text-gray-500 leading-relaxed">
              メールが届かないときは<b>迷惑メールフォルダ</b>もご確認ください。
            </p>
          </>
        ) : (
          <form action={action} className="space-y-3">
            <input name="email" type="email" required placeholder="メールアドレス" autoComplete="email" className={field} />
            {state.error && <p className="text-sm text-[#BF0000]">{state.error}</p>}
            <button type="submit" disabled={pending} className="w-full h-11 rounded-lg bg-[#BF0000] text-white text-sm font-bold disabled:opacity-60">
              {pending ? "送信中..." : "再設定メールを送る"}
            </button>
          </form>
        )}
        <Link href="/login" className="block text-center mt-4 text-sm text-[#BF0000] font-medium">ログインに戻る</Link>
      </div>
    </main>
  );
}
