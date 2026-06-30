import Link from "next/link";
import { Flame, ArrowRight, TrendingUp, Package, BookOpen, Users } from "lucide-react";
import TrialBanner from "./TrialBanner";

// ログイン時のホーム＝パーソナルハブ。中古利益カタログ移行後は「儲かる中古の型番カタログ」への導線を主役にする。
// 旧モデル（出品中/発送待ち/出品ファネル＝連携・育成）は撤去＝研究ツール化。/api/ebay/deals,status,orders への依存も外した。
// 未ログインの集客LP(LandingPage)とは別面＝ここはログイン済みユーザーの“次にやること”ハブ。
const QUICK = [
  { href: "/ranking", Icon: TrendingUp, label: "利益ランキング" },
  { href: "/manage", Icon: Package, label: "商品管理" },
  { href: "/guide", Icon: BookOpen, label: "使い方ガイド" },
];

export default function HomeHub() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-8 space-y-5">
      {/* 無料トライアル中なら終了予告（あと◯日／その後 月¥X 自動継続）。trialing以外は何も出ない。 */}
      <TrialBanner />

      {/* 続きの一手＝中古の利益カタログを見る（いちばん進めるべき1アクション） */}
      <section aria-label="続きの一手">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">続きの一手</h2>
        </div>
        <Link
          href="/catalog"
          className="flex items-center gap-3 rounded-2xl p-4 shadow-md active:scale-[0.99] transition-transform bg-[#2D323B] text-white"
        >
          <span className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-[#A98B5C]/25">
            <Flame size={20} strokeWidth={1.9} className="text-white" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-black leading-tight">中古の利益カタログを見る</span>
            <span className="block text-[12px] text-white/75 leading-snug mt-0.5">
              <span className="whitespace-nowrap">eBayで売れてる型番</span><wbr />
              <span className="whitespace-nowrap"> × 中古の今の値段。</span><wbr />
              <span className="whitespace-nowrap">純利益が出る品を狙いましょう</span>
            </span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-white/80" aria-hidden="true" />
        </Link>
      </section>

      {/* クイックアクセス（よく使う3つ） */}
      <section aria-label="クイックアクセス">
        <div className="grid grid-cols-3 gap-2">
          {QUICK.map(({ href, Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center justify-center gap-1.5 bg-white border border-[#A98B5C]/25 rounded-2xl px-2 py-3.5 shadow-sm active:bg-gray-50 text-center"
            >
              <Icon size={18} strokeWidth={1.9} className="text-[#A98B5C]" aria-hidden="true" />
              <span className="text-[12px] font-bold text-gray-700 leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* チーム共有（差別化＝仲間と分業）。コンプラ＝分業/透明性の訴求に留める。 */}
      <section aria-label="チーム共有">
        <Link
          href="/team"
          className="flex items-center gap-3 rounded-2xl p-4 border border-[#A98B5C]/30 bg-[#A98B5C]/[0.06] shadow-sm active:bg-[#A98B5C]/10 transition-colors"
        >
          <span className="shrink-0 w-10 h-10 rounded-full bg-[#2D323B] flex items-center justify-center">
            <Users size={18} className="text-[#D8C089]" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-black text-gray-800">チームで分業する</span>
            <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">
              <span className="whitespace-nowrap">家族や仲間と在庫・収支・出品を共有</span><wbr />
              <span className="whitespace-nowrap">（権限は1人ずつ設定）。</span>
            </span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
