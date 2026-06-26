"use client";

import { useState } from "react";

// 出品中の商品の価格を、カタログの出品画面と同じ4段（±0育成 / 最安 / 中央値 / 高値）にワンタップで変更する。
// 公開中のeBayオファーを /api/ebay/list/edit が即更新（updateOfferPriceQuantity）。値は出品時の相場(psnap)から算出。
export default function PriceTierEdit({
  productId,
  tiers,
}: {
  productId: string;
  tiers: { breakeven: number; low: number; median: number; high: number };
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [doneUsd, setDoneUsd] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = async (key: string, usd: number) => {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch("/api/ebay/list/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, priceUsd: usd.toFixed(2) }),
      }).then((r) => r.json());
      if (res.ok) setDoneUsd(usd);
      // 未知エラーはサーバー側で自動報告済み（recordAutoError）＝ユーザーには調査中であることだけ伝える。
      else if (res.errorKind === "unexpected") setErr("エラーが発生しました。自動で報告したので調査して直します。");
      else setErr(res.error || "価格を変更できませんでした。");
    } catch {
      setErr("通信エラーで変更できませんでした。");
    }
    setBusy(null);
  };

  const OPTS: { key: string; label: string; usd: number }[] = [
    { key: "breakeven", label: "±0(育成)", usd: tiers.breakeven },
    { key: "low", label: "最安", usd: tiers.low },
    { key: "median", label: "中央値", usd: tiers.median },
    { key: "high", label: "高値", usd: tiers.high },
  ];

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-2">
      <p className="text-[11px] font-bold text-gray-600 mb-1.5">価格を変更（eBayに即反映）</p>
      <div className="grid grid-cols-4 gap-1.5">
        {OPTS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => apply(o.key, o.usd)}
            disabled={busy !== null || o.usd <= 0}
            className="flex flex-col items-center justify-center h-11 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[11px] font-bold disabled:opacity-40 active:bg-gray-100 leading-tight"
          >
            <span>{o.label}</span>
            <span className="text-[10px] text-gray-400">{o.usd > 0 ? `$${Math.round(o.usd)}` : "—"}</span>
          </button>
        ))}
      </div>
      {doneUsd != null && <p className="mt-1 text-[10px] text-emerald-600 font-bold">✓ ${doneUsd.toFixed(2)} に変更しました</p>}
      {err && <p className="mt-1 text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
