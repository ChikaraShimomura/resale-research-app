import Link from "next/link";
import { BadgeCheck, ExternalLink } from "lucide-react";
import BottomNav from "../components/BottomNav";
import PlanCards from "../components/PlanCards";
import ProfitSampleStrip from "../components/ProfitSampleStrip";
import { COCONALA_URL, COCONALA_IS_AD } from "../lib/coconala";
import { PAYWALL_ENABLED } from "../lib/plans";
import { getPlan } from "../lib/auth/plan";

// 料金ページ。PAYWALL_ENABLED が立つまでは「現在すべて無料」を明示して課金不安を解消する。
// 立ったら有料プラン（ライト/スタンダード/プロ）の申込カードを出す。
export const metadata = {
  title: "料金 | 輸出ラボ",
  alternates: { canonical: "/pricing" },
};

// PAYWALL_ENABLED(サーバーenv)を「実行時」に評価する。静的生成だとビルド時のenvが焼き付き、
// 後からenvを変えても反映されない（＝再ビルド必須）。動的化して env を切り替えたら即反映されるようにする。
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  // ログイン購読者には現在のプランを反映して「ご利用中／アップグレード」を出し分ける。
  const currentPlan = PAYWALL_ENABLED ? await getPlan() : "free";
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#2D323B] px-3 py-3 shadow-sm sticky top-0 z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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
            {/* 転換前の後押し：未購読には「30日無料で解放される価値」を先頭で明示し、
                すぐ下に本物の利益商品サンプル（ランキングTop3・くっきり）を見せて価値を実感させる。 */}
            {currentPlan === "free" && (
              <>
                <div className="bg-gradient-to-br from-[#2D323B] to-[#1A1D23] text-white rounded-2xl p-5 mb-4 text-center shadow-md">
                  <p className="text-base font-black mb-1.5">利益商品はプランで解放</p>
                  <p className="text-[12px] text-white/85 leading-relaxed">
                    毎日更新の利益商品リサーチと、写真だけの自動出品。<br />
                    <b className="text-yellow-300">最初の30日は無料</b>でぜんぶ試せます。合わなければ解約するだけ。
                  </p>
                </div>
                <ProfitSampleStrip />
              </>
            )}
            <p className="text-center text-sm text-gray-500 leading-relaxed mb-5">
              使う量に合わせて選べます。<br />まずは<b className="text-gray-700">ライト（約1ヶ月無料）</b>から。
            </p>
            <PlanCards currentPlan={currentPlan} />
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

        {/* 個別サポート（任意・非楽天の収益導線）。eBayセラー登録=最初の1回が最大の難所→詰まった時だけ他社(ココナラ)に相談。 */}
        <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-6 mt-3 text-center">
          <p className="text-sm font-black text-gray-800 mb-1.5">eBayのセラー登録でつまずいたら（任意）</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
            海外輸出の副業で<b className="text-gray-700">最大の難所がeBayのセラー登録</b>。でも登録は<b className="text-gray-700">最初の1回だけ</b>なので、よく分かっている人に手伝ってもらうのが結局いちばん早いです。<b className="text-gray-700">ココナラ（他社サービス）なら数千円</b>でベテランに登録・出品をサポートしてもらえます。
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

        {/* 法務リンク（有料＝特商法表記を購入導線の近くに置く） */}
        <div className="mt-4 text-center flex items-center justify-center gap-3 flex-wrap">
          <Link href="/faq" className="text-[11px] text-gray-400 underline">よくある質問</Link>
          <Link href="/legal" className="text-[11px] text-gray-400 underline">特定商取引法に基づく表記</Link>
          <Link href="/terms" className="text-[11px] text-gray-400 underline">利用規約</Link>
          <Link href="/privacy" className="text-[11px] text-gray-400 underline">プライバシー</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
