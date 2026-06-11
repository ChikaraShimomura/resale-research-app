"use client";

export type SortOrder = "default" | "desc" | "asc";

// 商品リストを並び替える共有ヘルパー。"default" は登録順（API順=新着先頭）をそのまま返す。
export function sortProducts<T extends { realProfitRate: number }>(
  products: T[],
  order: SortOrder
): T[] {
  if (order === "default") return products;
  return [...products].sort((a, b) =>
    order === "desc"
      ? b.realProfitRate - a.realProfitRate
      : a.realProfitRate - b.realProfitRate
  );
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
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
        aria-label="並び替え"
        className="appearance-none min-h-[40px] pl-3 pr-8 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 focus:outline-none focus:border-[#CC0033]"
      >
        <option value="default">新着順</option>
        <option value="desc">利益率が高い順</option>
        <option value="asc">利益率が低い順</option>
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2.5 text-gray-400 text-[10px]">▼</span>
    </div>
  );
}
