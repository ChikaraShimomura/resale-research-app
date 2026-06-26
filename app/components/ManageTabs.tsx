import Link from "next/link";
import { Heart, ShoppingBag, Tag } from "lucide-react";

// 「商品管理」の3サブタブ：お気に入り → 仕入れ商品 → 出品中の商品（この順）。件数つき。
// 1つのページ(/manage)を ?tab= で切替（お気に入り→仕入れた→出品中の自然な流れ）。
const TABS = [
  { key: "fav", label: "お気に入り", Icon: Heart },
  { key: "bought", label: "仕入れ商品", Icon: ShoppingBag },
  { key: "listed", label: "出品中の商品", Icon: Tag },
] as const;

export default function ManageTabs({
  active,
  counts,
}: {
  active: "fav" | "bought" | "listed";
  counts?: Partial<Record<"fav" | "bought" | "listed", number>>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      {TABS.map(({ key, label, Icon }) => {
        const on = active === key;
        const n = counts?.[key];
        return (
          <Link
            key={key}
            href={`/manage?tab=${key}`}
            aria-current={on ? "page" : undefined}
            className={`inline-flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl text-[12px] font-bold border transition-colors leading-tight ${
              on ? "bg-[#2D323B] text-white border-[#2D323B]" : "bg-white text-gray-500 border-[#A98B5C]/30 active:bg-gray-50"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Icon size={14} /> {label}
            </span>
            {typeof n === "number" && <span className={`text-[10px] font-bold ${on ? "text-white/80" : "text-gray-400"}`}>{n}</span>}
          </Link>
        );
      })}
    </div>
  );
}
