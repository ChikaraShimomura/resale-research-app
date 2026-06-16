"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { signInAction } from "../auth/actions";
import type { AuthState } from "../auth/types";

const initial: AuthState = {};
const field =
  "w-full h-11 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#BF0000]/30 focus:border-[#BF0000]";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signInAction, initial);
  // メール確認リンクの期限切れ等で /login?e=confirm に飛ばされた場合に説明を出す（沈黙させない）。
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("e");
    if (e === "confirm") {
      setNotice("確認リンクの有効期限が切れているか、すでに使用済みのようです。もう一度ログインするか、新規登録をやり直してください。");
    }
  }, []);
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">ログイン</h1>
        <p className="text-sm text-gray-500 mb-5">サインインすると、利益ダッシュボードが端末を跨いで保存されます。</p>
        {notice && (
          <p className="mb-4 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-relaxed">
            {notice}
          </p>
        )}
        <form action={action} className="space-y-3">
          <input name="email" type="email" required placeholder="メールアドレス" autoComplete="email" className={field} />
          <input name="password" type="password" required placeholder="パスワード" autoComplete="current-password" className={field} />
          {state.error && <p className="text-sm text-[#BF0000]">{state.error}</p>}
          <button type="submit" disabled={pending} className="w-full h-11 rounded-lg bg-[#BF0000] text-white text-sm font-bold disabled:opacity-60">
            {pending ? "確認中..." : "ログイン"}
          </button>
        </form>
        <div className="flex justify-between mt-4 text-sm">
          <Link href="/register" className="text-[#BF0000] font-medium">新規登録</Link>
          <Link href="/reset-password" className="text-gray-500">パスワードを忘れた</Link>
        </div>
        <Link href="/search" className="block text-center mt-4 text-xs text-gray-400">登録せずに使う（ゲスト）</Link>
      </div>
    </main>
  );
}
