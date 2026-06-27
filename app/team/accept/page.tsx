import type { Metadata } from "next";
import Link from "next/link";
import { getInvite } from "../../lib/team";
import { getCurrentUserEmail } from "../../lib/auth/plan";
import AcceptInviteButton from "../../components/AcceptInviteButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チーム招待の承認", robots: { index: false } };

// メールを伏せて表示（招待リンクが転送されても本人以外に平文露出しないように）。例: foo@example.com → f***@example.com
function maskEmail(e: string): string {
  const [u, d] = String(e || "").split("@");
  if (!u || !d) return "****";
  return `${u[0]}***@${d}`;
}

export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invite = token ? await getInvite(token) : null;
  const email = await getCurrentUserEmail();

  const back = `/team/accept?token=${encodeURIComponent(token || "")}`;
  const matched = invite && email && email.toLowerCase() === invite.inviteeEmail.toLowerCase();

  return (
    <div className="min-h-dvh bg-[#F5F7FA] flex items-center justify-center px-4" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="w-full max-w-md bg-white border border-[#A98B5C]/25 rounded-2xl p-6 shadow-sm text-center">
        <h1 className="text-lg font-black text-gray-900 mb-2">チーム共有の招待</h1>

        {!invite ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-5">
              <span className="whitespace-nowrap">この招待リンクは無効か、</span><wbr />
              <span className="whitespace-nowrap">期限切れ（7日）です。</span><wbr />
              <span className="whitespace-nowrap">招待した方に、</span><wbr />
              <span className="whitespace-nowrap">もう一度送ってもらってください。</span>
            </p>
            <Link href="/" className="inline-flex items-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
              トップへ
            </Link>
          </>
        ) : !email ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
              <span className="whitespace-nowrap"><b>{maskEmail(invite.ownerEmail)}</b> さんの</span><wbr />
              <span className="whitespace-nowrap">チームに招待されています。</span>
            </p>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
              <span className="whitespace-nowrap">承認には招待先のアカウント</span><wbr />
              <span className="whitespace-nowrap">（<b>{maskEmail(invite.inviteeEmail)}</b>）での</span><wbr />
              <span className="whitespace-nowrap">ログインが必要です。</span>
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(back)}`}
              className="inline-flex items-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]"
            >
              ログインして承認
            </Link>
            <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
              <span className="whitespace-nowrap">うまく進まない時は、</span><wbr />
              <span className="whitespace-nowrap">ログイン後に、</span><wbr />
              <span className="whitespace-nowrap">メールのリンクを</span><wbr />
              <span className="whitespace-nowrap">もう一度開いてください。</span>
            </p>
          </>
        ) : !matched ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
              <span className="whitespace-nowrap">この招待は</span><wbr />
              <span className="whitespace-nowrap"><b>{maskEmail(invite.inviteeEmail)}</b> 宛です。</span>
            </p>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
              <span className="whitespace-nowrap">いまは <b>{email}</b> で</span><wbr />
              <span className="whitespace-nowrap">ログイン中です。</span><wbr />
              <span className="whitespace-nowrap">招待されたアカウントで</span><wbr />
              <span className="whitespace-nowrap">ログインし直してください。</span>
            </p>
            <Link href="/mypage" className="inline-flex items-center h-11 px-6 bg-white border border-[#2D323B]/30 text-[#2D323B] font-bold text-sm rounded-xl active:bg-gray-50">
              マイページ
            </Link>
          </>
        ) : (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
              <span className="whitespace-nowrap"><b>{invite.ownerEmail}</b> さんの</span><wbr />
              <span className="whitespace-nowrap">チームに参加します。</span>
            </p>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
              <span className="whitespace-nowrap">承認すると、</span><wbr />
              <span className="whitespace-nowrap">相手の「仕入れた商品」と</span><wbr />
              <span className="whitespace-nowrap">収支（仕入れ額・売上額）を</span><wbr />
              <span className="whitespace-nowrap">見られます。</span>
            </p>
            <AcceptInviteButton token={token || ""} />
          </>
        )}
      </div>
    </div>
  );
}
