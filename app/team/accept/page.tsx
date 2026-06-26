import type { Metadata } from "next";
import Link from "next/link";
import { getInvite } from "../../lib/team";
import { getCurrentUserEmail } from "../../lib/auth/plan";
import AcceptInviteButton from "../../components/AcceptInviteButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チーム招待の承認", robots: { index: false } };

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
            <p className="text-[13px] text-gray-600 leading-relaxed mb-5">この招待リンクは無効か、期限切れ（7日）です。招待した方にもう一度送ってもらってください。</p>
            <Link href="/" className="inline-flex items-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
              トップへ
            </Link>
          </>
        ) : !email ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
              <b>{invite.ownerEmail}</b> さんのチームに招待されています。
            </p>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
              承認には <b>{invite.inviteeEmail}</b> のアカウントでのログインが必要です。
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(back)}`}
              className="inline-flex items-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]"
            >
              ログインして承認
            </Link>
            <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">うまく進まない時は、ログイン後にメールのリンクをもう一度開いてください。</p>
          </>
        ) : !matched ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
              この招待は <b>{invite.inviteeEmail}</b> 宛です。
            </p>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
              いまは <b>{email}</b> でログイン中です。招待されたアカウントでログインし直してください。
            </p>
            <Link href="/mypage" className="inline-flex items-center h-11 px-6 bg-white border border-[#2D323B]/30 text-[#2D323B] font-bold text-sm rounded-xl active:bg-gray-50">
              マイページ
            </Link>
          </>
        ) : (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
              <b>{invite.ownerEmail}</b> さんのチームに参加します。
            </p>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
              承認すると、相手の「仕入れた商品」と収支（仕入れ額・売上額）を見られます。
            </p>
            <AcceptInviteButton token={token || ""} />
          </>
        )}
      </div>
    </div>
  );
}
