import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import BottomNav from "../components/BottomNav";

// 料金ページ。有料機能は未実装のため「現在すべて無料」を明示し、課金不安を解消する。
// （以前は /search への redirect だったが、無料であることを伝える機会を回収する）
export const metadata = {
  title: "料金 | 輸出ラボ",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#BF0000] px-3 py-3 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-1 py-2 flex items-center gap-2 max-w-2xl mx-auto">
          <Link
            href="/"
            aria-label="ホームに戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95"
          >
            ‹
          </Link>
          <h1 className="text-white font-black text-base">料金</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <BadgeCheck size={44} className="mx-auto text-emerald-500 mb-3" aria-hidden="true" />
          <p className="text-2xl font-black text-gray-800 mb-2">現在、すべて無料</p>
          <p className="text-sm text-gray-500 leading-relaxed mb-2">
            利益商品のリサーチも、写真だけの自動出品も、<br />登録不要で無料でご利用いただけます。
          </p>
          <p className="text-[12px] text-gray-400 leading-relaxed mb-7">
            ※ かかるのは楽天での仕入れ費用や、売れたときのeBay手数料（落札価格の13.25%＋¥47）だけです。
          </p>
          <Link
            href="/search"
            className="inline-block bg-[#BF0000] hover:bg-[#9E0000] active:bg-[#9E0000] text-white font-black px-8 py-3.5 rounded-xl text-sm transition-all shadow-md"
          >
            利益商品を見る →
          </Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
