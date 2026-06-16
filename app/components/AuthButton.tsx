"use client";
// ヘッダー用のアカウント表示。Supabase未設定(env無し)なら何も描画しない＝従来UIのまま。
// ログイン時はメール＋ログアウト、未ログイン時は「ログイン」リンク。
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient, supabaseEnabled } from "../lib/supabase/client";
import { signOutAction } from "../auth/actions";

export default function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled()) {
      setReady(true);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseEnabled() || !ready) return null;

  if (!email) {
    return (
      <Link href="/login" className="text-xs font-bold text-white/95 border border-white/60 rounded-full px-3 py-1">
        ログイン
      </Link>
    );
  }
  return (
    <form action={signOutAction} className="flex items-center gap-1.5">
      <span className="text-[11px] text-white/85 max-w-[110px] truncate" title={email}>{email}</span>
      <button type="submit" className="text-[11px] font-bold text-white/95 border border-white/50 rounded-full px-2.5 py-1">
        ログアウト
      </button>
    </form>
  );
}
