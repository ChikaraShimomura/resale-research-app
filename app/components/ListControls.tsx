"use client";
import { useRouter } from "next/navigation";
import SortSelect, { SortOrder } from "./SortSelect";
import { useLoggedIn } from "../lib/auth/useLoggedIn";

// 並び替えプルダウン（右寄せ）。未ログイン(locked)時は「おすすめ順」だけ使える。
// それ以外の並び替えを選んだら、その場で新規会員登録ページ(/register)へ誘導する（会員限定機能）。
export default function ListControls({
  sortOrder,
  onSortChange,
}: {
  sortOrder: SortOrder;
  onSortChange: (v: SortOrder) => void;
}) {
  const router = useRouter();
  const { locked } = useLoggedIn();

  const handleSort = (v: SortOrder) => {
    if (locked && v !== "recommended") {
      router.push("/register?from=filter"); // おすすめ順以外は会員限定＝登録導線（from=filterで流入元を計測）
      return;
    }
    onSortChange(v);
  };

  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <SortSelect value={locked ? "recommended" : sortOrder} onChange={handleSort} locked={locked} />
    </div>
  );
}
