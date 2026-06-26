"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

// 「仕入れ商品」一覧から外す（仕入れ印を取り消し＝undo）。誤って仕入れたを押した時や、出品し終えた時に使う。
export default function RemoveBoughtButton({ productId, teamOwner }: { productId: string; teamOwner?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const remove = async () => {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", productId, teamOwner }),
      }).then((r) => r.json());
      if (res.ok) router.refresh();
      else { setBusy(false); setErr(true); }
    } catch {
      setBusy(false);
      setErr(true);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      {err && <span className="text-[10px] text-rose-600 font-bold">外せませんでした</span>}
      <button
        onClick={remove}
        disabled={busy}
        className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg border border-gray-300 bg-white text-gray-500 text-[11px] font-bold disabled:opacity-40 active:bg-gray-50 focus-visible:ring-2 focus-visible:ring-[#2D323B]/40"
      >
        <X size={12} /> 一覧から外す
      </button>
    </span>
  );
}
