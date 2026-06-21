import { Flame } from "lucide-react";
import { getTopProfitProducts } from "../lib/topProducts";

// 会員誘導ページ（/pricing）用の「利益商品サンプル」。
// ランキングTop3を“掲載された見た目そのまま”でくっきり小さく見せ、登録（プラン）の価値を一目で伝える。
// ここは意図的にぼかさず実物を見せるサンプル（ランキングTop5のモザイクとは別目的）。
// 商品は KV から取得（/pricing は force-dynamic なので毎回最新）。0件なら何も出さない。
const yen = (n?: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

export default async function ProfitSampleStrip() {
  const items = await getTopProfitProducts(3);
  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4 mb-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Flame size={16} className="text-[#2D323B] shrink-0" aria-hidden="true" />
        <p className="text-[13px] font-black text-gray-800">今日の利益商品トップ3（サンプル）</p>
      </div>
      <ol className="space-y-2">
        {items.map((p, i) => (
          <li
            key={p.id}
            className="flex items-center gap-2.5 rounded-xl border border-[#A98B5C]/20 bg-[#F8F9FB] p-2"
          >
            <span className="w-5 shrink-0 text-center font-black text-[#2D323B] text-sm tabular-nums">
              {i + 1}
            </span>
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.imageUrl}
                alt=""
                className="w-11 h-11 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-lg bg-gray-100 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-gray-800 leading-snug line-clamp-1">{p.title}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                楽天 {yen(p.source?.price)} <span className="text-gray-300">→</span> eBay想定{" "}
                <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span>
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[#2D323B] font-black text-[13px] tabular-nums">
              <Flame size={12} aria-hidden="true" />
              {p.realProfitRate}%
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-gray-500 mt-3 text-center leading-relaxed">
        これは今日の一例です。プランに登録すると、<b className="text-gray-700">毎日更新の利益商品すべて</b>が見られます。
      </p>
      {/* 打消し表示（景表法）：/ranking・/guide・ホームfooterと同じく、数値は確定利益でなく想定（目安）である旨を明示 */}
      <p className="text-[10px] text-gray-400 mt-1.5 text-center leading-relaxed">
        ※ eBay想定売値・利益率はeBayの現在出品ベースの<b>想定（目安）</b>で、状態・競合・為替などにより変動します。
      </p>
    </div>
  );
}
