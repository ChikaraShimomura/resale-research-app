"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, Copy, Check } from "lucide-react";
import { supabaseEnabled, createSupabaseBrowserClient } from "../lib/supabase/client";

// 2段階認証（TOTP・認証アプリ方式＝無料）の登録/解除UI。設定ページに置く。
// 管理画面(/admin)は2FA(aal2)必須にしているので、管理者は必ずここで登録する必要がある。
export default function MfaSetup() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sb = supabaseEnabled() ? createSupabaseBrowserClient() : null;

  const refresh = async () => {
    if (!sb) return;
    const { data } = await sb.auth.mfa.listFactors();
    const v = (data?.totp ?? []).find((f) => f.status === "verified");
    setEnrolled(!!v);
    setVerifiedFactorId(v?.id ?? null);
  };

  useEffect(() => {
    if (!sb) { setLoggedIn(false); return; }
    sb.auth.getUser().then(async ({ data }) => {
      if (!data?.user) { setLoggedIn(false); return; }
      await refresh();
      setLoggedIn(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sb || loggedIn === false) return null;
  if (loggedIn === null) return <p className="text-[12px] text-gray-400">読み込み中…</p>;

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      // 未確認の古いfactorは消してから新規発行（重複防止）
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.totp ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) { setErr(error?.message || "開始に失敗しました。"); return; }
      setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enroll) return;
    setBusy(true); setErr(null);
    try {
      const { data: ch, error: ce } = await sb.auth.mfa.challenge({ factorId: enroll.factorId });
      if (ce || !ch) { setErr(ce?.message || "確認に失敗しました。"); return; }
      const { error: ve } = await sb.auth.mfa.verify({ factorId: enroll.factorId, challengeId: ch.id, code: code.trim() });
      if (ve) { setErr("コードが正しくありません。認証アプリの最新の6桁を入れてください。"); return; }
      setEnroll(null); setCode(""); await refresh();
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!verifiedFactorId) return;
    setBusy(true); setErr(null);
    try {
      await sb.auth.mfa.unenroll({ factorId: verifiedFactorId });
      await refresh();
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="text-sm font-black text-gray-800 mb-1 flex items-center gap-1.5">
        <ShieldCheck size={15} className="text-[#A98B5C]" /> 2段階認証（2FA・無料）
      </h2>

      {enrolled ? (
        <>
          <p className="text-[12px] text-emerald-600 font-bold flex items-center gap-1.5 mb-2">
            <Check size={14} /> 設定済み。ログイン後に認証アプリの6桁で本人確認します。
          </p>
          <button onClick={remove} disabled={busy}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 text-gray-600 text-[12px] font-bold disabled:opacity-40 active:bg-gray-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} 解除する
          </button>
        </>
      ) : enroll ? (
        <>
          <p className="text-[12px] text-gray-600 leading-relaxed mb-2">
            ① 認証アプリ（Google Authenticator / Microsoft Authenticator 等）で下のQRを読み取る → ② 表示された6桁を入力。
          </p>
          <div className="bg-white border border-[#A98B5C]/25 rounded-xl p-3 w-fit mx-auto mb-2 [&_svg]:w-40 [&_svg]:h-40"
            dangerouslySetInnerHTML={{ __html: enroll.qr }} />
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-[11px] text-gray-400">手入力用キー：</span>
            <code className="text-[11px] bg-gray-100 px-2 py-0.5 rounded break-all">{enroll.secret}</code>
            <button onClick={() => { navigator.clipboard?.writeText(enroll.secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="text-gray-400 active:scale-90">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          </div>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" placeholder="6桁コード"
              className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-gray-300 text-[14px] tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40" />
            <button onClick={confirm} disabled={busy || code.length !== 6}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#2D323B] text-white text-[13px] font-bold disabled:opacity-40 active:bg-[#1A1D23]">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} 確認
            </button>
          </div>
          <button onClick={() => { setEnroll(null); setCode(""); setErr(null); }} className="mt-2 text-[11px] text-gray-400 underline">キャンセル</button>
        </>
      ) : (
        <>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-2">
            認証アプリ（無料）で、ログイン時に6桁の確認を追加します。<b className="text-gray-700">管理画面（/admin）に入るには必須</b>です。
          </p>
          <button onClick={start} disabled={busy}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-[#2D323B] text-white text-sm font-bold disabled:opacity-50 active:bg-[#1A1D23]">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={15} />} 2段階認証を設定する
          </button>
        </>
      )}

      {err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
    </div>
  );
}
