"use client";

import { useState } from "react";

// エラー表示の共通部品。友好文(message)を出し、未知エラー(errorKind=unexpected または不明)の時だけ
// 「開発者に報告」ボタンを出す。報告は既存 /api/report/error へ（生エラー errorDetail を同梱）。
// 既知エラー(errorKind=known)は要因が分かっているので報告ボタンは出さない。
interface Props {
  message: string;
  errorKind?: "known" | "unexpected";
  errorDetail?: string; // 生エラー（ユーザーには見せず報告に同梱）
  where: string; // 報告の分類。例 "ebay_edit" / "ebay_location" / "ebay_policy"
  context?: Record<string, unknown>; // 報告に足したい追加情報（productId 等）
  className?: string;
}

export default function ReportableError({ message, errorKind, errorDetail, where, context, className }: Props) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  if (!message) return null;
  const unexpected = errorKind !== "known"; // known 以外（unexpected / 不明）は報告導線を出す

  const report = async () => {
    setState("sending");
    try {
      await fetch("/api/report/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ where, message: errorDetail || message, ...(context || {}) }),
      }).catch(() => {});
    } finally {
      setState("done");
    }
  };

  return (
    <div className={className}>
      <p className="text-[12px] text-red-600 leading-relaxed">{message}</p>
      {unexpected && (
        <button
          type="button"
          onClick={report}
          disabled={state !== "idle"}
          className="mt-1.5 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-[#2D323B] text-white text-[11px] font-bold active:opacity-90 disabled:opacity-50"
        >
          {state === "idle" ? "🛠 開発者に報告" : state === "sending" ? "送信中…" : "✓ 報告しました"}
        </button>
      )}
    </div>
  );
}
