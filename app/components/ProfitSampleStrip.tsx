import { Flame } from "lucide-react";
import { getUsedCatalog, isProhibited, conditionLabel } from "../lib/usedCatalog";

// 「儲かる中古サンプル」＝中古カタログ(used_catalog)の上位を“実物のまま”くっきり見せ、登録/プランの価値を一目で伝える。
// 価値の前出し用にホーム(壁の前)と /pricing の両方で使う。getUsedCatalog は確定品(ebayConfirmed)・売切除外・ROI≥10% を満たす純利益順。
// ⚠️ 公開してよい範囲は /ranking と同じ（ブランド/商品名・仕入れ値→eBay想定・利益率・画像）。
//    モートの核＝「仕入れ先(店/URL)」はサンプルには出さない（そこはプランで解放）。0件なら何も出さない。
const yen = (n?: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

export default async function ProfitSampleStrip() {
  const items = (await getUsedCatalog())
    .filter((p) => p.profitRate >= 5 && !isProhibited(`${p.brand} ${p.name}`))
    .slice(0, 3);
  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4 mb-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Flame size={16} className="text-[#2D323B] shrink-0" aria-hidden="true" />
        <p className="text-[13px] font-black text-gray-800">今日の儲かる中古 トップ3（サンプル）</p>
      </div>
      <ol className="space-y-2">
        {items.map((p, i) => {
          const cond = conditionLabel(p.condition);
          return (
            <li
              key={`${p.modelKey}-${i}`}
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
                <p className="text-[11px] font-bold text-gray-800 leading-snug line-clamp-1">
                  {`${p.brand} ${p.name}`.trim()}
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                  {cond.rank ? <span className="text-gray-400">{cond.label}・</span> : null}
                  仕入れ {yen(p.buyJpy)} <span className="text-gray-300">→</span> eBay想定{" "}
                  <span className="text-[#0064D2] font-bold">{yen(p.ebayMedianJpy)}</span>
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-0.5 text-[#2D323B] font-black text-[13px] tabular-nums">
                <Flame size={12} aria-hidden="true" />
                {p.profitRate}%
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-gray-500 mt-3 text-center leading-relaxed">
        <span className="whitespace-nowrap">これは今日の一例。</span><wbr />
        <span className="whitespace-nowrap">登録すると<b className="text-gray-700">毎日更新の</b></span><wbr />
        <span className="whitespace-nowrap"><b className="text-gray-700">儲かる中古すべて</b>と</span><wbr />
        <span className="whitespace-nowrap"><b className="text-gray-700">仕入れ先</b>が見られます。</span>
      </p>
      {/* 打消し表示（景表法）：/ranking・/guide・ホームfooterと同じく、数値は確定利益でなく想定（目安）である旨を明示 */}
      <p className="text-[10px] text-gray-400 mt-1.5 text-center leading-relaxed">
        <span className="whitespace-nowrap">※ eBay想定売値・利益率は</span><wbr />
        <span className="whitespace-nowrap">直近落札（実売値）ベースの<b>想定（目安）</b>。</span><wbr />
        <span className="whitespace-nowrap">状態・競合・為替や在庫で変動します。</span>
      </p>
    </div>
  );
}
