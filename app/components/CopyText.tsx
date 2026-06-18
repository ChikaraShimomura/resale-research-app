"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

// 任意テキストをコピーするボタン付きブロック（プレスキットの紹介文・動画台本/キャプション用）。
export default function CopyText({ text, label = "コピー" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };
  return (
    <div className="relative bg-[#F5F7FA] border border-[#A98B5C]/25 rounded-xl p-3.5">
      <pre className="whitespace-pre-wrap break-words text-[12px] text-gray-700 leading-relaxed font-sans pr-16">{text}</pre>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-lg border border-[#A98B5C]/35 bg-white px-2.5 py-1.5 text-[11px] font-bold text-gray-600 active:bg-gray-50"
      >
        {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} className="text-gray-400" />}
        {copied ? "済" : label}
      </button>
    </div>
  );
}
