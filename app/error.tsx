"use client";
// ルートのエラーバウンダリ。想定外の例外で英語の白画面を出さず、日本語の案内＋再試行/トップ導線を出す。
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 失敗の把握用に最小限ログ（個人情報は載せない）。
    try { console.error("route error:", error?.message, error?.digest); } catch { /* noop */ }
  }, [error]);
  return (
    <div className="min-h-dvh bg-[#F5F7FA] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
        <p className="text-3xl mb-2" aria-hidden="true">⚠️</p>
        <h1 className="text-sm font-black text-gray-800 mb-1">一時的なエラーが発生しました</h1>
        <p className="text-[12px] text-gray-500 mb-5 leading-relaxed">少し時間をおいて、もう一度お試しください。</p>
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="flex-1 h-11 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]"
          >
            もう一度
          </button>
          <Link href="/" className="flex-1 h-11 inline-flex items-center justify-center border border-[#A98B5C]/35 text-gray-700 font-bold text-sm rounded-xl active:bg-gray-50">
            トップへ
          </Link>
        </div>
      </div>
    </div>
  );
}
