import Link from "next/link";
import { Flame, ArrowRight } from "lucide-react";

// ログイン時のホーム＝パーソナルハブ。中古利益カタログ移行後は「儲かる中古の型番カタログ」への導線を主役にする。
// 旧モデル（出品中/発送待ち/出品ファネル＝連携・育成）は撤去＝研究ツール化。/api/ebay/deals,status,orders への依存も外した。
export default function HomeHub() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-8 space-y-5">
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
              eBayで売れてる型番 × 中古の今の値段。純利益が出る品を狙いましょう
            </span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-white/80" aria-hidden="true" />
        </Link>
      </section>

      {/* 補助導線：ガイド */}
      <section className="text-center pt-1">
        <Link href="/guide" className="text-[12px] font-bold text-gray-500 underline underline-offset-2">
          使い方ガイドを見る →
        </Link>
      </section>
    </div>
  );
}
