import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReferralStats } from "../../lib/referralServer";

// 運営者専用の紹介(成果報酬)集計画面。env REFERRAL_ADMIN_KEY と ?key= が一致しないと 404。
// 例: /admin/referrals?key=あなたの秘密キー
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "紹介集計", robots: { index: false } };

export default async function ReferralsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  const secret = process.env.REFERRAL_ADMIN_KEY?.trim();
  if (!secret || key !== secret) notFound();

  const stats = await getReferralStats();
  const totalClicks = stats.reduce((a, s) => a + s.clicks, 0);
  const totalSignups = stats.reduce((a, s) => a + s.signups, 0);

  return (
    <div className="min-h-dvh bg-[#F5F7FA]">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 max-w-2xl mx-auto">
          <span className="text-white font-black text-base tracking-tight">紹介(成果報酬)集計</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-white rounded-xl border border-[#A98B5C]/25 shadow-sm p-3 text-center">
            <p className="text-[11px] text-gray-400">総クリック</p>
            <p className="text-xl font-black text-gray-800">{totalClicks.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#A98B5C]/25 shadow-sm p-3 text-center">
            <p className="text-[11px] text-gray-400">総登録(成果)</p>
            <p className="text-xl font-black text-[#2D323B]">{totalSignups.toLocaleString()}</p>
          </div>
        </div>

        {stats.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center text-sm text-gray-500">
            まだ紹介データがありません。インフルエンサーに <code className="bg-gray-100 px-1 rounded">/r/コード</code> のリンクを渡してください。
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 text-left text-[11px] text-gray-500">
                  <th className="px-3 py-2.5 font-bold">コード</th>
                  <th className="px-3 py-2.5 font-bold text-right">クリック</th>
                  <th className="px-3 py-2.5 font-bold text-right">登録(成果)</th>
                  <th className="px-3 py-2.5 font-bold text-right">登録率</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.code} className="border-t border-[#A98B5C]/15">
                    <td className="px-3 py-2.5 font-mono font-bold text-gray-800 break-all">{s.code}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{s.clicks.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-black text-[#2D323B]">{s.signups.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">
                      {s.clicks > 0 ? Math.round((s.signups / s.clicks) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-[11px] text-gray-400 leading-relaxed">
          成果報酬は<b>「登録(成果)」</b>の件数で計算します（例：登録1件×単価）。インフルエンサーごとに固有のコードを決めて <code className="bg-gray-100 px-1 rounded">/r/コード</code> のリンクを渡してください（例：<code className="bg-gray-100 px-1 rounded">/r/yuko-yt</code>）。
        </p>
      </main>
    </div>
  );
}
