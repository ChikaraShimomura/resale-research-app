"use client";
import Link from "next/link";
import { useActionState } from "react";
import { updatePasswordAction } from "../../auth/actions";
import type { AuthState } from "../../auth/types";
import BrandHome from "../../components/BrandHome";

const initial: AuthState = {};
const field =
  "w-full h-11 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D323B]/30 focus:border-[#2D323B]";

export default function UpdatePasswordPage() {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <BrandHome className="mb-5" />
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">新しいパスワード</h1>
        <p className="text-sm text-gray-500 mb-5">新しいパスワードを設定してください。</p>
        <form action={action} className="space-y-3">
          <input name="password" type="password" required minLength={8} placeholder="新しいパスワード（8文字以上）" autoComplete="new-password" className={field} />
          {state.error && <p className="text-sm text-[#2D323B]">{state.error}</p>}
          <button type="submit" disabled={pending} className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold disabled:opacity-60">
            {pending ? "更新中..." : "パスワードを更新"}
          </button>
        </form>
        {/* 行き止まり防止: リンク期限切れ等で更新できない時の出口を用意 */}
        <p className="mt-4 text-[11px] text-gray-400 text-center leading-relaxed">
          うまくいかないときは、メールの「再設定リンク」から開き直すか、
          <Link href="/reset-password" className="text-[#2D323B] underline underline-offset-2">パスワードを忘れた</Link>
          からやり直してください。
        </p>
        <Link href="/login" className="block text-center mt-3 text-sm text-gray-500">ログインに戻る</Link>
      </div>
    </main>
  );
}
