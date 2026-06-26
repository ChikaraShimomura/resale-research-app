import type { Metadata } from "next";
import Link from "next/link";
import { getActorId } from "../lib/auth/actor";
import { getCurrentUserEmail } from "../lib/auth/plan";
import { getRoster, getPending, getMyTeams, getTeamName } from "../lib/team";
import BottomNav from "../components/BottomNav";
import TeamManager from "../components/TeamManager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チーム共有", robots: { index: false } };

export default async function TeamPage() {
  const actor = await getActorId();
  const email = await getCurrentUserEmail();
  const [roster, pending, myTeams, teamName] = actor
    ? await Promise.all([getRoster(actor), getPending(actor), getMyTeams(actor), getTeamName(actor)])
    : [[], [], [], ""];

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link
            href="/mypage"
            aria-label="マイページへ"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95"
          >
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">チーム共有</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
          会員のメンバーを招待して、あなたの<b>「仕入れた商品」一覧</b>と<b>収支（仕入れ額・売上額）</b>を共有できます。共有は読み取り専用で、相手が承認したときだけ有効です。
        </p>
        {actor && email ? (
          <TeamManager roster={roster} pending={pending} myTeams={myTeams} teamName={teamName} />
        ) : (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-gray-700 mb-1">ログインが必要です</p>
            <p className="text-[12px] text-gray-500 mb-4">チーム共有はログイン中のアカウントごとに管理します。</p>
            <Link href="/login" className="inline-flex items-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
              ログイン
            </Link>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
