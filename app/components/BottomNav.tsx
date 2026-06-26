"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Home, Flame, ShoppingBag, User } from "lucide-react";
import Spinner from "./Spinner";

// 会員制・中古カタログの4タブ：ホーム → 利益カタログ(探す) → 商品管理(お気に入り/仕入れ/出品中) → マイページ。
// ※「商品管理」は1宛先＝/manage（中で3タブ切替）。旧 /bought・/favorites は /manage に集約（リダイレクト）。
// ※ランキングは「いったん不要」(ユーザー指示2026-06-26)で外した。出品管理/発送/育成も非表示(研究ツール化)。
const NAV_ITEMS = [
  { href: "/",        Icon: Home,        label: "ホーム",     match: (p: string) => p === "/" },
  { href: "/catalog", Icon: Flame,       label: "カタログ",   match: (p: string) => p.startsWith("/catalog") },
  { href: "/manage",  Icon: ShoppingBag, label: "商品管理",   match: (p: string) => p.startsWith("/manage") || p.startsWith("/bought") || p.startsWith("/favorites") },
  { href: "/mypage",  Icon: User,        label: "マイページ", match: (p: string) => p.startsWith("/mypage") },
] as const;

// Link の子として描画し、その Link の遷移中(pending)はアイコンの代わりにグルグルを出す（タブ切替の待ち時間を可視化）。
function NavInner({
  Icon,
  isActive,
  label,
}: {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  isActive: boolean;
  label: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <>
      {/* 遷移中は aria-busy で「処理中」を伝える。視覚はグルグル、読み上げは下の sr-only に集約 */}
      <span
        className="flex items-center justify-center"
        style={{ width: 22, height: 22 }}
        aria-busy={pending || undefined}
      >
        {pending ? <Spinner size={20} /> : <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} />}
      </span>
      <span className={`text-[10px] whitespace-nowrap ${isActive ? "font-bold text-[#2D323B]" : "font-normal"}`}>
        {label}
      </span>
      {/* 遷移中だけ読み上げる読み込み状態（視覚非表示）。スピナーの role は重複回避のため使わない想定だが既存挙動は変えない */}
      {pending && (
        <span role="status" className="sr-only">
          読み込み中
        </span>
      )}
    </>
  );
}

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#A98B5C]/35 flex items-stretch justify-around z-20"
      style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-0.5 flex-1 min-h-[52px] transition-colors ${
              isActive ? "text-[#2D323B]" : "text-gray-500"
            }`}
          >
            <NavInner Icon={item.Icon} isActive={isActive} label={item.label} />
          </Link>
        );
      })}
    </nav>
  );
}
