import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import MyDashboard from "../components/MyDashboard";
import { getPlan } from "../lib/auth/plan";

export const metadata: Metadata = {
  title: "マイページ",
  robots: { index: false }, // 個人の成績ページは検索除外
};

export const dynamic = "force-dynamic"; // 管理者判定(getPlan)を実行時に行うため

export default async function MyPage() {
  const isAdminUser = (await getPlan()) === "admin"; // 管理者だけ「管理」導線を出す
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">マイページ</span>
          <div className="ml-auto flex items-center gap-1.5">
            {isAdminUser && (
              <Link href="/admin" aria-label="管理画面"
                className="inline-flex items-center gap-1 h-9 px-3 rounded-full bg-[#A98B5C] text-white text-[12px] font-bold shrink-0 active:scale-95">
                <ShieldCheck size={14} /> 管理
              </Link>
            )}
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <MyDashboard />
      </main>

      <BottomNav />
    </div>
  );
}
