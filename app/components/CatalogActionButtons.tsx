"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Undo2 } from "lucide-react";

// 中古カタログ各カードの小さな triage ボタン。「仕入れた」「これは無理」を per-actor で記録して一覧から外す。
// 押下後は楽観的に「記録しました＋元に戻す」へ。再読込/次回訪問時はサーバー側フィルタで非表示が確定する。
export default function CatalogActionButtons({ productId, buyJpy }: { productId: string; buyJpy: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"bought" | "skip" | "undo" | null>(null);
  const [done, setDone] = useState<"bought" | "skip" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const post = async (action: "bought" | "skip" | "undo") => {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 「仕入れた」は仕入れ値も送って収支の累計に乗せる（skip/undoでは無視される）。
        body: JSON.stringify({ action, productId, buyJpy }),
      }).then((r) => r.json());
      if (res.ok) {
        if (action === "undo") {
          setDone(null);
          router.refresh(); // 印を消してカタログに戻す
        } else {
          setDone(action); // カードはこのセッションは残し、次回読込でサーバーが非表示にする
        }
      } else {
        setErr(res.error || "操作に失敗しました。");
      }
    } catch {
      setErr("通信エラーで操作できませんでした。");
    }
    setBusy(null);
  };

  if (done) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
        <span className="text-[11px] font-bold text-gray-600">
          {done === "bought" ? "✓「仕入れ商品」に追加しました" : "非表示にしました（次回から表示されません）"}
        </span>
        <button
          onClick={() => post("undo")}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0064D2] disabled:opacity-40"
        >
          <Undo2 size={12} /> 元に戻す
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        <button
          onClick={() => post("bought")}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-1 h-8 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40 active:bg-emerald-700"
        >
          <Check size={13} /> 仕入れた
        </button>
        <button
          onClick={() => post("skip")}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-1 h-8 rounded-lg border border-gray-300 bg-white text-gray-500 text-[11px] font-bold disabled:opacity-40 active:bg-gray-50"
        >
          <X size={13} /> これは無理
        </button>
      </div>
      {err && <p className="mt-1 text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
