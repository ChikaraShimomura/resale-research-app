import type { Metadata } from "next";
import Link from "next/link";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import MyDashboard from "../components/MyDashboard";

export const metadata: Metadata = {
  title: "マイページ",
  robots: { index: false }, // 個人の成績ページは検索除外
};

export default function MyPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">マイページ</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <MyDashboard />
      </main>

      <BottomNav />
    </div>
  );
}
