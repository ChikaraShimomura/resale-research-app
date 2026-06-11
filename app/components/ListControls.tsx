"use client";
import SortSelect, { SortOrder } from "./SortSelect";

// 並び替えプルダウン + 「SOLDを除外」チェックを右寄せ・上下に並べるコントロール。
// チェックボックスは appearance:none の影響を受けないよう自前で描画（□＋レ点）。
export default function ListControls({
  sortOrder,
  onSortChange,
  hideSold,
  onHideSoldChange,
}: {
  sortOrder: SortOrder;
  onSortChange: (v: SortOrder) => void;
  hideSold: boolean;
  onHideSoldChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <SortSelect value={sortOrder} onChange={onSortChange} />
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={hideSold}
          onChange={(e) => onHideSoldChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center text-white text-[11px] leading-none transition-colors ${
            hideSold ? "bg-[#CC0033] border-[#CC0033]" : "bg-white border-gray-400"
          }`}
        >
          {hideSold ? "✓" : ""}
        </span>
        SOLDを除外
      </label>
    </div>
  );
}
