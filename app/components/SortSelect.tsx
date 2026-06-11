"use client";
import { ProfitProduct } from "../lib/profitFilter";

export type SortOrder = "default" | "rate" | "profit" | "rival";

const profitAmount = (p: ProfitProduct) => p.realProfit + (p.source.pointAmount ?? 0);

// 商品リストを並び替える共有ヘルパー。"default" は登録順（API順=新着先頭）をそのまま返す。
export function sortProducts(products: ProfitProduct[], order: SortOrder): ProfitProduct[] {
  switch (order) {
    case "rate": // 利益率が高い順
      return [...products].sort((a, b) => b.realProfitRate - a.realProfitRate);
    case "profit": // 利益金額（実質利益＝利益＋ポイント）が高い順
      return [...products].sort((a, b) => profitAmount(b) - profitAmount(a));
    case "rival": // ライバルの少ない順（eBay簡単出品が押された回数の少ない順）
      return [...products].sort((a, b) => (a.listingCount ?? 0) - (b.listingCount ?? 0));
    default: // 新着順（登録順）
      return products;
  }
}

// モバイルではOSネイティブのピッカーが出るので <select> を採用。
export default function SortSelect({
  value,
  onChange,
}: {
  value: SortOrder;
  onChange: (v: SortOrder) => void;
}) {
  return (
    <div className="relative inline-flex items-center shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
        aria-label="並び替え"
        className="appearance-none h-7 pl-2.5 pr-7 rounded-lg border border-gray-200 bg-white text-[11px] font-bold text-gray-700 focus:outline-none focus:border-[#BF0000]"
      >
        <option value="default">新着順</option>
        <option value="rate">利益率が高い順</option>
        <option value="profit">利益金額が高い順</option>
        <option value="rival">ライバルの少ない順</option>
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 text-gray-400 text-[9px]">▼</span>
    </div>
  );
}
