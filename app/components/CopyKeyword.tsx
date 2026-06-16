"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

// 検索ワードをタップでコピーできるチップ。ココナラの検索窓に貼り付けてもらう誘導用。
export default function CopyKeyword({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* クリップボード不可の環境では何もしない（ワード自体は表示されている） */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`「${value}」をコピー`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[12px] font-bold text-amber-900 active:bg-amber-50"
    >
      <span>「{value}」</span>
      {copied ? <Check size={13} className="text-emerald-600 shrink-0" /> : <Copy size={13} className="text-amber-500 shrink-0" />}
      <span className="text-[10px] font-normal text-amber-500">{copied ? "コピーしました" : "タップでコピー"}</span>
    </button>
  );
}
