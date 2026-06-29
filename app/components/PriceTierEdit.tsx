"use client";

import { useState } from "react";
import { USD_JPY } from "../lib/ebay/landedCost";

// 出品中の商品の価格を、カタログの出品画面と同じ4段（±0育成 / 最安 / 中央値 / 高値）にワンタップで変更する。
// 公開中のeBayオファーを /api/ebay/list/edit が即更新（updateOfferPriceQuantity）。値は出品時の相場(psnap)から算出。
export default function PriceTierEdit({
  productId,
  tiers,
  currentPriceUsd,
}: {
  productId: string;
  tiers: { breakeven: number; low: number; median: number; high: number; profit?: { breakeven: number; low: number; median: number; high: number } };
  currentPriceUsd?: number; // 今eBayに出ている価格(USD)。損益分岐を下回っていれば赤字警告＋ワンタップ修正を出す。
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [doneUsd, setDoneUsd] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 表示は円（eBayは$建てだが、ユーザーには円で見せる）。レートは SSOT(landedCost・env駆動/既定155)から。
  const yen = (u: number) => "¥" + Math.round(u * USD_JPY).toLocaleString("ja-JP");
  const yenJ = (j: number) => "¥" + Math.round(j).toLocaleString("ja-JP"); // 円そのもの(利益額用・USD換算しない)

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

  const OPTS: { key: string; label: string; usd: number; profit?: number }[] = [
    { key: "breakeven", label: "±0(育成)", usd: tiers.breakeven, profit: tiers.profit?.breakeven },
    { key: "low", label: "最安", usd: tiers.low, profit: tiers.profit?.low },
    { key: "median", label: "中央値", usd: tiers.median, profit: tiers.profit?.median },
    { key: "high", label: "高値", usd: tiers.high, profit: tiers.profit?.high },
  ];

  // 今の価格が損益分岐(±0)を下回る＝赤字で出品中。古い計算で出した分のケア（ワンタップで±0へ引き上げ）。
  const belowFloor = !!currentPriceUsd && currentPriceUsd > 0 && tiers.breakeven > 0 && currentPriceUsd < tiers.breakeven;

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-2">
      {belowFloor && doneUsd == null && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-2.5 py-2">
          <p className="text-[11px] font-bold text-rose-700 leading-snug">
            <span aria-hidden="true">⚠️ </span>今の価格 {yen(currentPriceUsd!)} は損益分岐 {yen(tiers.breakeven)} を下回り<b>赤字</b>です。
          </p>
          <button
            type="button"
            onClick={() => apply("breakeven", tiers.breakeven)}
            disabled={busy !== null || !(tiers.breakeven > 0)}
            className="mt-1.5 w-full h-9 rounded-lg bg-rose-600 text-white text-[12px] font-bold disabled:opacity-50 active:bg-rose-700"
          >
            {busy === "breakeven" ? "変更中…" : `損益分岐(±0) ${yen(tiers.breakeven)} に引き上げる`}
          </button>
        </div>
      )}
      <p className="text-[11px] font-bold text-gray-600 mb-1.5">価格を変更（eBayに即反映）</p>
      <div className="grid grid-cols-4 gap-1.5">
        {OPTS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => apply(o.key, o.usd)}
            disabled={busy !== null || o.usd <= 0}
            className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg border border-[#A98B5C]/35 bg-white text-gray-600 text-[11px] font-bold disabled:opacity-40 active:bg-gray-100 leading-tight"
          >
            <span>{o.label}</span>
            <span className="text-[10px] text-gray-400">{o.usd > 0 ? yen(o.usd) : "—"}</span>
            {o.usd > 0 && o.profit != null && (
              <span className="text-[10px] font-bold text-pink-600">{o.profit >= 0 ? "+" : ""}{yenJ(o.profit)}</span>
            )}
          </button>
        ))}
      </div>
      {doneUsd != null && <p className="mt-1 text-[10px] text-emerald-600 font-bold">✓ {yen(doneUsd)} に変更しました</p>}
      {err && <p className="mt-1 text-[11px] text-rose-600 leading-snug whitespace-pre-line">{err}</p>}
    </div>
  );
}
