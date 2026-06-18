import Link from "next/link";

// 認証画面など、ヘッダーの無いページ用のブランドロゴ。押すとトップへ戻れる（迷子防止）。
export default function BrandHome({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="輸出ラボ トップへ"
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <span className="w-7 h-7 bg-[#2D323B] rounded-full flex items-center justify-center shadow-sm ring-1 ring-[#A98B5C]/60">
        <span className="text-white font-black text-sm leading-none">R</span>
      </span>
      <span className="text-[#2D323B] font-black text-base tracking-tight">輸出ラボ</span>
    </Link>
  );
}
