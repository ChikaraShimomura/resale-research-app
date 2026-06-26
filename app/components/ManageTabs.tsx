import Link from "next/link";
import { Heart, ShoppingBag, Tag, Archive } from "lucide-react";

// 「商品管理」の4サブタブ：お気に入り → 仕入れ商品 → 出品中の商品 → 終了商品（この順）。件数つき。
// 1つのページ(/manage)を ?tab= で切替。終了商品＝停止中／過去の出品（出品中タブから分離）。
const TABS = [
  { key: "fav", label: "お気に入り", Icon: Heart },
  { key: "bought", label: "仕入れ商品", Icon: ShoppingBag },
  { key: "listed", label: "出品中の商品", Icon: Tag },
  { key: "ended", label: "終了商品", Icon: Archive },
] as const;

export type ManageTabKey = (typeof TABS)[number]["key"];

export default function ManageTabs({
  active,
  counts,
}: {
  active: ManageTabKey;
  counts?: Partial<Record<ManageTabKey, number>>;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 mb-4">
      {TABS.map(({ key, label, Icon }) => {
        const on = active === key;
        const n = counts?.[key];
        return (
          <Link
            key={key}
            href={`/manage?tab=${key}`}
            aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl text-[11px] font-bold border transition-colors text-center leading-none ${
              on ? "bg-[#2D323B] text-white border-[#2D323B]" : "bg-white text-gray-500 border-[#A98B5C]/30 active:bg-gray-50"
            }`}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
            {typeof n === "number" && <span className={`text-[10px] font-bold ${on ? "text-white/80" : "text-gray-400"}`}>{n}</span>}
          </Link>
        );
      })}
    </div>
  );
}
