import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserEmail } from "../lib/auth/plan";
import { isAdmin } from "../lib/auth/admin";
import { createSupabaseServerClient } from "../lib/supabase/server";
import MastersAdmin from "../components/MastersAdmin";

// 管理者ハブ。ログイン中のメールが ADMIN_EMAILS のときだけ表示（それ以外は404）。
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "管理", robots: { index: false } };

export default async function AdminPage() {
  const email = await getCurrentUserEmail();
  if (!isAdmin(email)) notFound();

  // 管理者は2段階認証(aal2)必須。未登録なら設定へ、未通過(aal1)なら検証ページへ誘導。
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasTotp = (factors?.totp ?? []).some((f) => f.status === "verified");
  if (!hasTotp) redirect("/settings?mfa=setup");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/auth/mfa?next=/admin");

  return (
    <div className="min-h-dvh bg-[#F5F7FA]">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">管理</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        {/* 身内(master)の指定。ここに入れたメールのアカウントは無料・無制限になる。 */}
        <section className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
          <MastersAdmin />
        </section>

        {/* 既存の運営ツールへの導線。 */}
        <section className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
          <h2 className="text-sm font-black text-gray-800 mb-2">その他の管理</h2>
          <Link href="/admin/referrals" className="text-[13px] text-[#2D323B] underline">
            紹介(成果報酬)集計 →
          </Link>
          <p className="text-[11px] text-gray-400 mt-1">※ 紹介集計は <code className="bg-gray-100 px-1 rounded">?key=</code> が必要です。</p>
        </section>
      </main>
    </div>
  );
}
