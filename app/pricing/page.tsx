import Link from "next/link";
import { BadgeCheck, ExternalLink } from "lucide-react";
import BottomNav from "../components/BottomNav";
import PlanCards from "../components/PlanCards";
import { COCONALA_URL, COCONALA_IS_AD } from "../lib/coconala";
import { PAYWALL_ENABLED } from "../lib/plans";

// 料金ページ。PAYWALL_ENABLED が立つまでは「現在すべて無料」を明示して課金不安を解消する。
// 立ったら有料プラン（アマチュア/ベテラン/プロ）の申込カードを出す。
export const metadata = {
  title: "料金 | 輸出ラボ",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#2D323B] px-3 py-3 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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
        {PAYWALL_ENABLED ? (
          <div className="mb-3">
            <p className="text-center text-sm text-gray-500 leading-relaxed mb-5">
              使う量に合わせて選べます。<br />まずは<b className="text-gray-700">アマチュア（約2ヶ月無料）</b>から。
            </p>
            <PlanCards />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-8 text-center">
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
              className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:bg-[#1A1D23] text-white font-black px-8 py-3.5 rounded-xl text-sm transition-all shadow-md"
            >
              利益商品を見る →
            </Link>
          </div>
        )}

        {/* 個別サポート（任意・非楽天の唯一の収益導線）。ツールは無料のまま、つまずいた時だけ他社に相談。 */}
        <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-6 mt-3 text-center">
          <p className="text-sm font-black text-gray-800 mb-1.5">つまずいたら個別サポート（任意）</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
            eBayのセラー登録や出品でどうしても進めない時は、<b className="text-gray-700">ココナラ（他社サービス）</b>でベテランに相談できます。ツール自体は無料のまま、サポートが欲しい時だけ。
          </p>
          <a
            href={COCONALA_URL}
            target="_blank"
            rel="nofollow sponsored noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-white border border-[#2D323B]/30 text-[#2D323B] font-bold px-6 py-3 rounded-xl text-sm active:bg-gray-50"
          >
            ココナラでサポートを探す{COCONALA_IS_AD ? "（広告）" : ""} <ExternalLink size={14} />
          </a>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
