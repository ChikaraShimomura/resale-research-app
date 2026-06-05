"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/search",    emoji: "🏠", label: "ホーム" },
  { href: "/results?q=", emoji: "🔍", label: "検索",    matchPath: "/results" },
  { href: "/favorites", emoji: "❤️", label: "お気に入り" },
  { href: "/guide",     emoji: "📖", label: "ガイド" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex items-center justify-around px-2 pt-2 z-20 shadow-lg"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          ("matchPath" in item ? pathname.startsWith(item.matchPath) : pathname === item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 min-w-[3rem] ${
              isActive ? "text-indigo-600" : "text-gray-400"
            }`}
          >
            <span className="text-xl leading-none">{item.emoji}</span>
            <span className={`text-xs ${isActive ? "font-semibold" : "font-medium"}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
