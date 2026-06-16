"use client";
import { useState } from "react";
import Link from "next/link";
import SortSelect, { SortOrder } from "./SortSelect";
import { useLoggedIn } from "../lib/auth/useLoggedIn";

// 並び替えプルダウン + 「ライバル多数を隠す」チェックを右寄せ・上下に並べるコントロール。
// チェックボックスは appearance:none の影響を受けないよう自前で描画（□＋レ点）。
// 未ログイン(locked)時は「おすすめ順」だけ使える。それ以外の並び替え・絞り込みはログイン誘導。
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
  const { locked } = useLoggedIn();
  const [hint, setHint] = useState(false);

  const handleSort = (v: SortOrder) => {
    if (locked && v !== "recommended") {
      setHint(true);
      return; // おすすめ順以外は未ログインだと選べない
    }
    onSortChange(v);
  };
  const handleHideSold = (v: boolean) => {
    if (locked && v) {
      setHint(true);
      return; // 絞り込みONは未ログインだと使えない
    }
    onHideSoldChange(v);
  };

  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <SortSelect value={locked ? "recommended" : sortOrder} onChange={handleSort} locked={locked} />
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={locked ? false : hideSold}
          onChange={(e) => handleHideSold(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center text-white text-[11px] leading-none transition-colors ${
            !locked && hideSold ? "bg-[#BF0000] border-[#BF0000]" : "bg-white border-gray-400"
          }`}
        >
          {!locked && hideSold ? "✓" : ""}
        </span>
        {locked ? "🔒 ライバル多数を隠す" : "ライバル多数を隠す"}
      </label>
      {hint && (
        <Link
          href="/login?from=filter"
          className="max-w-[230px] text-right text-[11px] text-amber-900 bg-[#FFF7ED] border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed active:opacity-70"
        >
          🔒 並び替え・絞り込みは<b>ログイン</b>で使えます（おすすめ順は登録なしでOK）
        </Link>
      )}
    </div>
  );
}
