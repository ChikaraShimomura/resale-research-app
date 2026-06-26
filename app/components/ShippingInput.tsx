"use client";

import { useState } from "react";

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

// 仕入れた商品の送料（任意）。未入力（＝既定）は一律¥1,000で集計される。入力するとその額。原価＝仕入れ値＋送料。
export default function ShippingInput({ productId, buyJpy, initial, teamOwner }: { productId: string; buyJpy: number; initial: number; teamOwner?: string }) {
  const [val, setVal] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false); // 保存失敗を明示（送料は原価＝buyJpy+送料に直結するので無言失敗は実害）

  const save = async () => {
    const n = Math.min(100000, Math.max(0, Math.round(Number(val) || 0)));
    setVal(String(n));
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "shipping", productId, shippingJpy: n, teamOwner }),
      }).then((r) => r.json());
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1200); }
      else setErr(true);
    } catch { setErr(true); }
    setBusy(false);
  };

  const ship = Math.max(0, Math.round(Number(val) || 0));
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
        送料 ¥
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          disabled={busy}
          className="w-16 h-7 px-1.5 rounded-md border border-[#A98B5C]/40 text-[11px] text-right tabular-nums focus:outline-none focus:border-[#2D323B] disabled:opacity-50"
        />
        {saved && <span className="text-emerald-600 text-[11px] font-bold">✓</span>}
        {err && <span className="text-rose-600 text-[11px] font-bold">保存できませんでした</span>}
      </span>
      <span className="text-[11px] text-gray-500 tabular-nums">
        原価 <b className="text-gray-800">{yen(buyJpy + ship)}</b>
      </span>
    </div>
  );
}
