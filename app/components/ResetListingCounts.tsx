"use client";
import { useState } from "react";

// テスト用：自分の端末の出品カウントをリセット（/settings?reset=1 のときだけ表示）。
export default function ResetListingCounts() {
  const [state, setState] = useState<"idle" | "doing" | "done">("idle");
  const [removed, setRemoved] = useState(0);

  const run = async () => {
    setState("doing");
    const r = await fetch("/api/listing-count/reset", { method: "POST" })
      .then((x) => x.json())
      .catch(() => ({ removed: 0 }));
    setRemoved(r.removed ?? 0);
    setState("done");
  };

  return (
    <section className="bg-white rounded-2xl p-4 border border-amber-200 shadow-sm">
      <h2 className="text-sm font-black text-gray-800 mb-1">テスト用：出品カウントのリセット</h2>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        この端末で「eBay簡単出品（出品成功）」した分を、全商品から取り消します。他の人のデータには影響しません。
      </p>
      <button
        onClick={run}
        disabled={state === "doing"}
        className="h-10 px-4 bg-amber-500 text-white font-bold text-sm rounded-xl active:bg-amber-600 disabled:opacity-50"
      >
        {state === "done"
          ? `リセット完了（${removed}件）`
          : state === "doing"
          ? "リセット中..."
          : "自分の出品カウントをリセット"}
      </button>
    </section>
  );
}
