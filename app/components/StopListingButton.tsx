"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle } from "lucide-react";

// 出品中の商品を手動で「出品停止」する（eBayのオファーを取り下げ→停止中へ。記録は残り再出品できる）。
// 自動停止（仕入れ元の売切検知）とは別に、セラーが自分の判断で止められる導線。
export default function StopListingButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stop = async () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("この出品をeBayから取り下げて終了します（「停止中」に移ります・再出品も可能）。よろしいですか？")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/ebay/list/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }).then((r) => r.json());
      if (res.ok) { setBusy(false); router.refresh(); }
      else { setErr(res.error || "停止できませんでした。"); setBusy(false); }
    } catch {
      setErr("通信エラーで停止できませんでした。");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        onClick={stop}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 font-bold text-[12px] disabled:opacity-50 active:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <PauseCircle size={14} /> {busy ? "終了中…" : "出品を終了する"}
      </button>
      {err && <p className="text-[10px] text-rose-600 font-bold text-center">{err}</p>}
    </div>
  );
}
