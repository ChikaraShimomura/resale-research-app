"use client";
import { useState } from "react";

// 既存の出品中の商品から「値下げ交渉（Best Offer）」を一括で外す（移行用・冪等）。
// /api/ebay/listings/strip-best-offer を叩く。新規出品はそもそもBest Offerを付けない。
export default function StripBestOfferButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ebay/listings/strip-best-offer", { method: "POST" }).then((x) => x.json());
      if (r.connected === false) setMsg("先にeBayと連携してから実行してください。");
      else if (r.ok)
        setMsg(
          `出品中 ${r.checked} 件を確認し、${r.changed} 件から値下げ交渉を外しました。` +
            (r.failed ? `（${r.failed} 件は反映待ちの可能性。時間をおいて再実行してください）` : "")
        );
      else setMsg("実行できませんでした。時間をおいて再度お試しください。");
    } catch {
      setMsg("通信エラーで実行できませんでした。");
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-[#A98B5C]/20">
      <p className="text-[11px] text-gray-500 mb-1.5 leading-relaxed">
        値下げ交渉（Best Offer）は廃止しました。すでに出品中の商品からも外せます。
      </p>
      <button
        onClick={run}
        disabled={busy}
        className="h-10 px-4 rounded-xl border border-[#2D323B]/30 bg-white text-[#2D323B] text-[13px] font-bold active:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "実行中…" : "出品中から値下げ交渉を外す"}
      </button>
      {msg && <p className="text-[12px] text-gray-600 mt-2 leading-relaxed">{msg}</p>}
    </div>
  );
}
