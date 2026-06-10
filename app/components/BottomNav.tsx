"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/search",    icon: "🏠", label: "ホーム" },
  { href: "/results?q=", icon: "🔍", label: "検索", matchPath: "/results" },
  { href: "/favorites", icon: "❤️",  label: "お気に入り" },
  { href: "/guide",     icon: "📖", label: "ガイド" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-[#BF0000] flex items-stretch justify-around z-20"
      style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          ("matchPath" in item ? pathname.startsWith(item.matchPath) : pathname === item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-2 flex-1 min-h-[52px] ${
              isActive ? "text-[#BF0000]" : "text-gray-400"
            }`}
          >
            <span className="text-xl leading-none">{item.icon}</span>
            <span className={`text-[10px] ${isActive ? "font-black" : "font-medium"}`}>
              {item.label}
            </span>
            {isActive && <div className="w-4 h-0.5 bg-[#BF0000] rounded-full" />}
          </Link>
        );
      })}
    </nav>
  );
}
