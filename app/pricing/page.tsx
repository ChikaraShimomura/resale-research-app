import Link from "next/link";
import { BadgeCheck, ExternalLink, Users } from "lucide-react";
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

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // ログイン購読者には現在のプランを反映して「ご利用中／アップグレード」を出し分ける。
  const currentPlan = PAYWALL_ENABLED ? await getPlan() : "free";
  // どこから壁に当たって来たか＝文言を「押した先が有料だった」と腑に落ちる形に出し分ける（導線の改善のみ）。
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : undefined;
  // ログイン後の申込自動再開：/pricing?resume=<plan> で戻ってきたら、その有料プランの Checkout を再開する。
  const resumeRaw = typeof sp.resume === "string" ? sp.resume : undefined;
  const resumePlan =
    resumeRaw === "viewer" || resumeRaw === "amateur" || resumeRaw === "veteran" || resumeRaw === "pro" ? resumeRaw : undefined;
  const gateHeading =
    from === "product"
      ? "この商品の詳細はプランで解放"
      : from === "ranking"
        ? "各商品の詳細はプランで解放"
        : "利益商品はプランで解放";
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
                  <p className="text-base font-black mb-1.5">{gateHeading}</p>
                  <p className="text-[12px] text-white/85 leading-relaxed">
                    <span className="whitespace-nowrap">毎日更新の中古利益リサーチ</span><wbr />
                    <span className="whitespace-nowrap">（儲かる型番＋仕入れ先）。</span><wbr />
                    <span className="whitespace-nowrap"><b className="text-yellow-300">最初の30日無料</b>で全部試せる。</span><wbr />
                    <span className="whitespace-nowrap">合わなければ解約するだけ。</span>
                  </p>
                  {/* 不安解消：純利益が出る型番だけを狙える／固定費は最安プランの月¥5,000から。 */}
                  <p className="mt-2 text-[12px] font-bold text-white/95 leading-relaxed">
                    <span className="whitespace-nowrap">純利益が出る型番だけを狙えて、</span><wbr />
                    <span className="whitespace-nowrap">固定費は<b className="text-yellow-300">月¥5,000から</b>。</span>
                  </p>
                  {/* 回遊維持：壁に当たっても無料で見られる場所（ランキング）へ戻れることを明示。 */}
                  {(from === "ranking" || from === "product") && (
                    <Link href="/ranking?from=pricing"
                      className="mt-3 inline-block text-[12px] font-bold text-yellow-300 underline underline-offset-2 active:opacity-80">
                      ← ランキング（無料）に戻る
                    </Link>
                  )}
                </div>
                <ProfitSampleStrip />
              </>
            )}
            <p className="text-center text-sm text-gray-500 leading-relaxed mb-5">
              <span className="whitespace-nowrap">使う量で選べる。</span><wbr />
              <span className="whitespace-nowrap">まずは<b className="text-gray-700">ライト（約1ヶ月無料）</b>から。</span>
            </p>
            <PlanCards currentPlan={currentPlan} resumePlan={resumePlan} />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-8 text-center">
            <BadgeCheck size={44} className="mx-auto text-emerald-500 mb-3" aria-hidden="true" />
            <p className="text-2xl font-black text-gray-800 mb-2">現在、すべて無料</p>
            <p className="text-sm text-gray-500 leading-relaxed mb-2">
              <span className="whitespace-nowrap">中古の利益リサーチも、</span><wbr />
              <span className="whitespace-nowrap">儲かる型番カタログも、無料。</span>
            </p>
            <p className="text-[12px] text-gray-400 leading-relaxed mb-7">
              <span className="whitespace-nowrap">※ かかるのは中古の仕入れ費用と、</span><wbr />
              <span className="whitespace-nowrap">売れたときのeBay手数料</span><wbr />
              <span className="whitespace-nowrap">（海外決済・為替込みで約17%）だけ。</span>
            </p>
            <Link
              href="/catalog"
              className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:bg-[#1A1D23] text-white font-black px-8 py-3.5 rounded-xl text-sm transition-all shadow-md"
            >
              中古の利益カタログを見る →
            </Link>
          </div>
        )}

        {/* チーム共有（全プラン共通の強み・差別化）。分業/透明性/段階的拡大の訴求に留め収入断定はしない。 */}
        <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-6 mt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Users size={18} className="text-[#A98B5C] shrink-0" aria-hidden="true" />
            <p className="text-sm font-black text-gray-800">チームで使える（全プラン）</p>
          </div>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            <span className="whitespace-nowrap">家族や仲間と、仕入れ・出品・発送・収支を</span><wbr />
            <span className="whitespace-nowrap"><b className="text-gray-700">共有して分業</b>。</span><wbr />
            <span className="whitespace-nowrap">権限は1人ずつ設定でき、</span><wbr />
            <span className="whitespace-nowrap">在庫も売上もチーム全員で見えます。</span><wbr />
            <span className="whitespace-nowrap"><b className="text-gray-700">共有モード</b>＝オーナー1つのeBayで全員分、</span><wbr />
            <span className="whitespace-nowrap"><b className="text-gray-700">個別モード</b>＝各自のeBayで出品（在庫・収支は共有）。</span>
          </p>
        </div>

        {/* 個別サポート（任意）。eBayセラー登録=最初の1回が最大の難所→詰まった時だけ他社(ココナラ)に相談。 */}
        <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-6 mt-3 text-center">
          <p className="text-sm font-black text-gray-800 mb-1.5">eBayのセラー登録でつまずいたら（任意）</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
            <span className="whitespace-nowrap">輸出副業<b className="text-gray-700">最大の難所が</b></span><wbr />
            <span className="whitespace-nowrap"><b className="text-gray-700">eBayのセラー登録</b>。</span><wbr />
            <span className="whitespace-nowrap">でも<b className="text-gray-700">最初の1回だけ</b>なので、</span><wbr />
            <span className="whitespace-nowrap">分かる人に手伝ってもらうのが</span><wbr />
            <span className="whitespace-nowrap">結局いちばん早い。</span><wbr />
            <span className="whitespace-nowrap"><b className="text-gray-700">ココナラ（他社）なら数千円</b>で</span><wbr />
            <span className="whitespace-nowrap">ベテランに登録・出品を</span><wbr />
            <span className="whitespace-nowrap">サポートしてもらえます。</span>
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
