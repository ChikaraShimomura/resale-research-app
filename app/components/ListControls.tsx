"use client";
import { useRouter } from "next/navigation";
import SortSelect, { SortOrder } from "./SortSelect";
import { useLoggedIn } from "../lib/auth/useLoggedIn";

// 並び替えプルダウン + 「ライバル多数を隠す」チェックを右寄せ・上下に並べるコントロール。
// チェックボックスは appearance:none の影響を受けないよう自前で描画（□＋レ点）。
// 未ログイン(locked)時は「おすすめ順」だけ使える。それ以外の並び替え・絞り込みを選んだら
// その場で新規会員登録ページ(/register)へ誘導する（会員限定機能のクリック＝登録導線）。
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
  const router = useRouter();
  const { locked } = useLoggedIn();

  // 会員限定機能を未ログインで操作したら、新規会員登録ページへ。from=filter で登録の流入元を計測。
  const gateToRegister = () => router.push("/register?from=filter");

  const handleSort = (v: SortOrder) => {
    if (locked && v !== "recommended") {
      gateToRegister();
      return; // おすすめ順以外は会員限定
    }
    onSortChange(v);
  };
  const handleHideSold = (v: boolean) => {
    if (locked && v) {
      gateToRegister();
      return; // 絞り込みONは会員限定
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
    </div>
  );
}
