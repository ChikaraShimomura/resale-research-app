import type { Metadata } from "next";

// 輸出ラボ サービス終了のお知らせ（2026-07-22 ユーザー指示による畳み）。
// middleware が全ページをここへ rewrite する（/api/*・法務ページ・本ページは除外）。
export const metadata: Metadata = {
  title: "サービス終了のお知らせ｜輸出ラボ",
  robots: { index: false, follow: false },
};

export default function ClosedPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white border border-[#A98B5C]/25 rounded-2xl p-8 shadow-sm text-center">
        <p className="text-[13px] font-bold tracking-widest text-[#A98B5C] mb-3">輸出ラボ</p>
        <h1 className="text-xl font-black text-[#2D323B] leading-snug mb-4">
          サービス終了のお知らせ
        </h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-3">
          <span className="whitespace-nowrap">輸出ラボは、2026年7月22日をもちまして</span><wbr />
          <span className="whitespace-nowrap">サービスの提供を終了いたしました。</span>
        </p>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-3">
          <span className="whitespace-nowrap">ご利用中の有料プランの請求はすべて停止し、</span><wbr />
          <span className="whitespace-nowrap">未提供期間分は返金にて対応いたします。</span>
        </p>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-6">
          <span className="whitespace-nowrap">これまでのご利用、</span><wbr />
          <span className="whitespace-nowrap">誠にありがとうございました。</span>
        </p>
        <div className="flex items-center justify-center gap-4 text-[11px]">
          <a href="/legal" className="text-gray-400 underline">特定商取引法に基づく表記</a>
          <a href="/privacy" className="text-gray-400 underline">プライバシー</a>
        </div>
      </div>
    </div>
  );
}
