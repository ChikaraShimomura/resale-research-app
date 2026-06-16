"use client";
// 「サインインすると利益が端末跨ぎで保存される」ナッジ。Supabase未設定 or 既にログイン済みなら何も出さない。
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient, supabaseEnabled } from "../lib/supabase/client";

export default function SignInPrompt({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled()) return; // 認証OFF＝表示しない
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setShow(!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setShow(!session?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!show) return null;

  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 ${className}`}>
      <p className="text-[11px] text-amber-800 leading-snug">
        サインインすると、この実績が<b>端末を跨いで保存</b>されます。
      </p>
      <Link
        href="/login"
        className="shrink-0 text-[11px] font-bold text-white bg-[#BF0000] rounded-full px-3 py-1 active:scale-95"
      >
        ログイン
      </Link>
    </div>
  );
}
