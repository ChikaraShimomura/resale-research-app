"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import Spinner from "./Spinner";

// Link の子として描画し、その Link の遷移中(pending)はアイコンの代わりにグルグルを出す（タブ切替の待ち時間を可視化）。
function NavInner({ Icon, isActive, label }: { Icon: React.ComponentType<{ filled: boolean }>; isActive: boolean; label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className="flex items-center justify-center" style={{ width: 22, height: 22 }}>
        {pending ? <Spinner size={20} /> : <Icon filled={isActive} />}
      </span>
      <span className={`text-[11px] whitespace-nowrap ${isActive ? "font-bold text-[#2D323B]" : "font-normal"}`}>
        {label}
      </span>
    </>
  );
}

function HomeIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12L12 3l9 9" />
      <path d="M9 21V12h6v9" />
      <path d="M5 10v11h14V10" />
    </svg>
  );
}

function SearchIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="22" y2="22" />
    </svg>
  );
}

function UserIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20v-1c0-3.31 3.58-5 8-5s8 1.69 8 5v1" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/",          Icon: HomeIcon,   label: "ホーム",     match: ["/"] },
  { href: "/search",    Icon: SearchIcon, label: "さがす",     match: ["/search", "/results"] },
  { href: "/mypage",    Icon: UserIcon,   label: "マイページ", match: ["/mypage"] },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#A98B5C]/35 flex items-stretch justify-around z-20"
      style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/" ? pathname === "/" : item.match.some((p) => pathname.startsWith(p));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-2 flex-1 min-h-[52px] transition-colors ${
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
