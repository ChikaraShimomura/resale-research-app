import type { Metadata } from "next";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import EbayListingSetup from "../components/EbayListingSetup";

export const metadata: Metadata = {
  title: "設定",
  robots: { index: false },
};

export default function SettingsPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">設定</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
        <section className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
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
          <Link href="/privacy" className="text-xs text-gray-500 underline hover:text-[#BF0000]">プライバシーポリシー</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
