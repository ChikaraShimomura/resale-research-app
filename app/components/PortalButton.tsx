"use client";
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

// サブスクの管理（解約・支払い方法変更・領収書）を Stripe カスタマーポータルで開く。
export default function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const d = await r.json();
      if (d.ok && d.url) { window.location.href = d.url; return; }
      setErr(d.error || "ポータルを開けませんでした。");
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={open}
        disabled={busy}
        className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-[#2D323B]/30 text-[#2D323B] text-[13px] font-bold disabled:opacity-50 active:bg-[#2D323B]/5"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} プランを管理・解約
      </button>
      {err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
    </div>
  );
}
