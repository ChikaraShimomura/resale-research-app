"use client";

import { useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { reportClientError, errToDetail } from "../lib/clientError";

// 出品中の商品を「返品最小化テンプレ」に最適化する（タイトル・説明・Item Specifics を改訂）。
// 決定論テンプレ＝AI不使用＝連打しても課金ゼロ。価格・数量・画像は変えない。誤ったItem Specificsの是正にも使える。
export default function OptimizeButton({ productId, optimized = false, compact = false }: { productId: string; optimized?: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(optimized);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (busy || done) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/ebay/list/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      }).then((r) => r.json());
      if (res.ok) setDone(true);
      else {
        if (res.errorKind !== "known") reportClientError("ebay_optimize", { action: "optimize", endpoint: "/api/ebay/list/optimize", status: 0, detail: res.errorDetail || res.error || "(no detail)", productId });
        if (res.errorKind === "unexpected") setErr("エラーが発生しました。自動で報告したので調査して直します。");
        else setErr(res.error || "最適化できませんでした。");
      }
    } catch (e) {
      reportClientError("ebay_optimize", { action: "optimize", endpoint: "/api/ebay/list/optimize", status: 0, detail: `fetch例外: ${errToDetail(e)}`, productId });
      setErr("通信エラーで最適化できませんでした。");
    }
    setBusy(false);
  };

  if (done) {
    return compact ? (
      <p className="flex flex-col items-center justify-center gap-0.5 h-14 w-full rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[11px] leading-none">
        <Check size={15} /> <span>最適化済</span>
      </p>
    ) : (
      <p className="inline-flex items-center justify-center gap-1 h-9 w-full rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[12px]">
        <Check size={14} /> 最適化済み
      </p>
    );
  }
  if (compact) {
    return (
      <div className="space-y-1">
        <button
          onClick={run}
          disabled={busy}
          className="w-full flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl border border-[#A98B5C]/40 bg-[#A98B5C]/10 text-[#7A6336] font-bold text-[11px] leading-none disabled:opacity-50 active:bg-[#A98B5C]/20 focus-visible:ring-2 focus-visible:ring-[#A98B5C]/40"
        >
          <Sparkles size={15} /> <span>{busy ? "最適化中…" : "最適化"}</span>
        </button>
        {err && <p className="text-[10px] text-rose-600 font-bold text-center">{err}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <button
        onClick={run}
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-[#A98B5C]/40 bg-[#A98B5C]/10 text-[#7A6336] font-bold text-[12px] disabled:opacity-50 active:bg-[#A98B5C]/20 focus-visible:ring-2 focus-visible:ring-[#A98B5C]/40"
      >
        <Sparkles size={14} /> {busy ? "最適化中…" : "出品を最適化（タイトル・説明・項目）"}
      </button>
      {err && <p className="text-[10px] text-rose-600 font-bold text-center">{err}</p>}
    </div>
  );
}
