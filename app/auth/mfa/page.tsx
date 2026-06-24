"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Loader2 } from "lucide-react";
import { supabaseEnabled, createSupabaseBrowserClient } from "../../lib/supabase/client";

// ログイン後の2段階認証（TOTP）検証ページ。認証アプリの6桁でセッションを aal2 に昇格し、next へ戻す。
// 管理画面(/admin)が aal2 必須なので、未通過の管理者はここへ誘導される。
function MfaVerify() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/admin";
  const sb = supabaseEnabled() ? createSupabaseBrowserClient() : null;

  const [phase, setPhase] = useState<"loading" | "ready" | "none">("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sb) { router.replace("/login"); return; }
    (async () => {
      const { data: u } = await sb.auth.getUser();
      if (!u?.user) { router.replace(`/login?next=${encodeURIComponent("/auth/mfa")}`); return; }
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") { router.replace(next); return; } // 既に通過済み
      const { data: list } = await sb.auth.mfa.listFactors();
      const v = (list?.totp ?? []).find((f) => f.status === "verified");
      if (!v) { setPhase("none"); return; } // 未設定（先に登録が必要）
      const { data: ch } = await sb.auth.mfa.challenge({ factorId: v.id });
      setFactorId(v.id); setChallengeId(ch?.id ?? null); setPhase("ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    if (!sb || !factorId || !challengeId) return;
    setBusy(true); setErr(null);
    const { error } = await sb.auth.mfa.verify({ factorId, challengeId, code: code.trim() });
    setBusy(false);
    if (error) {
      setErr("コードが違います。認証アプリの最新の6桁を入力。");
      const { data: ch } = await sb.auth.mfa.challenge({ factorId }); // 期限切れ対策で再発行
      setChallengeId(ch?.id ?? null);
      setCode("");
      return;
    }
    router.replace(next); // aal2 に昇格 → 元のページへ
  };

  return (
    <div className="min-h-dvh bg-[#F5F7FA] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={20} className="text-[#A98B5C]" />
          <h1 className="text-base font-black text-gray-800">2段階認証</h1>
        </div>

        {phase === "loading" ? (
          <p className="text-[13px] text-gray-400">確認中…</p>
        ) : phase === "none" ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-3">
              2段階認証が未設定。<Link href="/settings" className="text-[#2D323B] underline">設定</Link>から先に登録を。
            </p>
            <Link href="/settings" className="inline-flex items-center h-10 px-4 rounded-xl bg-[#2D323B] text-white text-sm font-bold active:bg-[#1A1D23]">
              設定へ
            </Link>
          </>
        ) : (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-3">認証アプリに表示された6桁を入力。</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              placeholder="6桁コード"
              className="w-full h-12 px-3 rounded-lg border border-gray-300 text-lg tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40 mb-3"
            />
            <button
              onClick={verify}
              disabled={busy || code.length !== 6}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-[#2D323B] text-white text-sm font-black disabled:opacity-40 active:bg-[#1A1D23]"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} 確認して進む
            </button>
          </>
        )}
        {err && <p className="text-[12px] text-red-600 mt-3">{err}</p>}
      </div>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaVerify />
    </Suspense>
  );
}
