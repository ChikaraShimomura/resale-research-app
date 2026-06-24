"use client";
import { ProfitProduct } from "../lib/profitFilter";

export type SortOrder = "recommended" | "default" | "rate" | "profit" | "cheap" | "demand" | "rival";

// 利益金額（現金）。配信(/api/products)の realProfit は既に現金純利益（ポイント抜き）なのでそのまま使う。
const profitAmount = (p: ProfitProduct) => p.realProfit;
// 仕入れ(送料込)。カードの「仕入れ」表示と一致させる（安い順ソート用）。
const buyCost = (p: ProfitProduct) => (p.source.price ?? 0) + (p.source.shippingJpy ?? 0);

// 総合おすすめスコア＝利益率 × 需要(realCount・逓減) × 手頃さ ÷ ライバル数。
// 「利益率だけ高くて売れない/高額すぎ/競合だらけ」を自動で下げ、バランスの良い案件を上位に出す。
function recoScore(p: ProfitProduct): number {
  const rate = Math.max(0, Math.min(100, p.realProfitRate ?? 0));        // 利幅(0-100%にクランプ)
  // 実需＝eBay直近落札数(soldCount30d)を最優先、無ければ流動性(realCount=同等出品数)で代替。逓減。
  // max を取るので「実際に売れている品」だけ加点され、データ無しの品が下がることはない（単調・安全）。
  const demand = Math.log2(1 + Math.min(Math.max(p.soldCount30d ?? 0, p.realCount ?? 1), 30));
  const cost = buyCost(p) - (p.source.pointAmount ?? 0);                 // 実質の出費
  const afford = Math.max(0.5, Math.min(1.2, 1.2 - cost / 50000));       // 手頃さ(高額は微減/安価は微増)
  const rivalry = 1 + (p.listingCount ?? 0);                            // ライバル数で割る
  return (rate * demand * afford) / rivalry;
}

// 商品リストを並び替える共有ヘルパー。"default" は登録順（API順=新着先頭）をそのまま返す。
export function sortProducts(products: ProfitProduct[], order: SortOrder): ProfitProduct[] {
  switch (order) {
    case "recommended": // 総合おすすめ（利幅・需要・手頃さ・ライバルのバランス）
      return [...products].sort((a, b) => recoScore(b) - recoScore(a));
    case "rate": // 利益率が高い順
      return [...products].sort((a, b) => b.realProfitRate - a.realProfitRate);
    case "profit": // 利益金額（現金）が高い順
      return [...products].sort((a, b) => profitAmount(b) - profitAmount(a));
    case "cheap": // 仕入れが安い順（送料込・少額から始めやすい）
      return [...products].sort((a, b) => buyCost(a) - buyCost(b));
    case "demand": // 売れやすい順＝eBay直近落札数(soldCount30d＝実需の最有力シグナル)が多い順。
      // 同数(0含む)は流動性(realCount)→利益率で安定させる。realCount単独は「相場参照の出品数」で実売速度ではないため主軸にしない。
      return [...products].sort(
        (a, b) =>
          (b.soldCount30d ?? 0) - (a.soldCount30d ?? 0) ||
          (b.realCount ?? 0) - (a.realCount ?? 0) ||
          (b.realProfitRate ?? 0) - (a.realProfitRate ?? 0),
      );
    case "rival": // ライバルの少ない順（eBay自動出品が押された回数の少ない順）
      return [...products].sort((a, b) => (a.listingCount ?? 0) - (b.listingCount ?? 0));
    default: // 新着順（登録順）
      return products;
  }
}

// モバイルではOSネイティブのピッカーが出るので <select> を採用。
// locked=true（未ログイン）のときは「おすすめ順」以外に🔒を付け、選ぶとログイン誘導する（onChange側で制御）。
export default function SortSelect({
  value,
  onChange,
  locked = false,
}: {
  value: SortOrder;
  onChange: (v: SortOrder) => void;
  locked?: boolean;
}) {
  const lock = (label: string) => (locked ? `🔒 ${label}` : label);
  return (
    <div className="relative inline-flex items-center shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
        aria-label="並び替え"
        // タップ領域を確保(h-10=40px)。focusはfocus-visibleのリングでa11y担保(チャコール枠)。
        className="appearance-none h-10 pl-3 pr-8 rounded-lg border border-[#A98B5C]/35 bg-white text-[11px] font-bold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D323B]/40 focus-visible:border-[#2D323B]"
      >
        <option value="recommended">おすすめ順</option>
        <option value="default">{lock("新着順")}</option>
        <option value="rate">{lock("利益率が高い順")}</option>
        <option value="profit">{lock("利益金額が高い順")}</option>
        <option value="cheap">{lock("仕入れが安い順")}</option>
        <option value="demand">{lock("売れやすい順")}</option>
        <option value="rival">{lock("ライバルの少ない順")}</option>
      </select>
      {/* ▼アイコンを少し大きく(約12px)。クリックはselectへ素通し。 */}
      <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-gray-400 text-[12px] leading-none">▼</span>
    </div>
  );
}
