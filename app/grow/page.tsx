import type { Metadata } from "next";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import AccountGrowth from "../components/AccountGrowth";

// 「アカウントを育てる」：新規eBayアカウントは出品制限・評価ゼロ・低可視性で“出した＝売れる”にならない。
// 評価/実績を安全に積むための現在地＋スターター品＋コツを一か所に。ログイン必須(middlewareのゲート対象)。
export const metadata: Metadata = { title: "アカウント育成", robots: { index: false } };

export default function GrowPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <span className="text-white font-black text-base tracking-tight">アカウント育成</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <AccountGrowth />
      </main>

      <BottomNav />
    </div>
  );
}
