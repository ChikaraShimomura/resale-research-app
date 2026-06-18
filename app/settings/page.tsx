import type { Metadata } from "next";
import Link from "next/link";
import AuthButton from "../components/AuthButton";
import BottomNav from "../components/BottomNav";
import EbayListingSetup from "../components/EbayListingSetup";
import TrustBadges from "../components/TrustBadges";
import PushSettings from "../components/PushSettings";

export const metadata: Metadata = {
  title: "設定",
  robots: { index: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await searchParams;
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">設定</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
        {/* eBay・Payoneerの信頼バッジ（連携/登録の不安をその場でケア） */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <TrustBadges />
        </section>

        {/* プッシュ通知（オン/オフ＋受け取る種類を本人が選べる） */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <PushSettings />
        </section>

        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <h2 className="text-sm font-black text-gray-800 mb-1">eBay出品の準備</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            下のSTEPを上から順に進めるだけで、eBay出品の準備が完了します。ログイン不要・eBayのパスワードは渡されません。
          </p>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            ※ 連携情報はこの端末（ブラウザ）に紐づけて暗号化保存されます。共有端末では使用後にSTEP1の「連携を解除」をしてください。
          </p>
        </section>

        <EbayListingSetup />

        <div className="pt-1 text-center">
          <Link href="/privacy" className="text-xs text-gray-500 underline hover:text-[#2D323B]">プライバシーポリシー</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
