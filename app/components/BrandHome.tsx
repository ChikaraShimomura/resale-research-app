import Link from "next/link";

// 認証画面など、ヘッダーの無いページ用のブランドロゴ。押すとトップへ戻れる（迷子防止）。
export default function BrandHome({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="輸出ラボ トップへ"
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <span className="w-7 h-7 bg-[#BF0000] rounded-full flex items-center justify-center shadow-sm">
        <span className="text-white font-black text-sm leading-none">R</span>
      </span>
      <span className="text-[#BF0000] font-black text-base tracking-tight">輸出ラボ</span>
    </Link>
  );
}
