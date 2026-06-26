import type { Metadata } from "next";
import Link from "next/link";
import AuthButton from "../../components/AuthButton";
import BottomNav from "../../components/BottomNav";
import EbayListingSetup from "../../components/EbayListingSetup";
import ListingDefaultsSettings from "../../components/ListingDefaultsSettings";
import StripBestOfferButton from "../../components/StripBestOfferButton";

// 「eBayアカウント設定」＝連携先(eBay)のアカウント設定。連携・送料・発送先の国・返品・発送元・出品の既定値。
// このサービス自体のアカウント設定（プラン/2段階認証/通知）は /settings に分離（混在を避ける）。
// ?list= / ?ebay= は EbayListingSetup / EbayConnect が window.location から読むため、ここではサーバー処理は不要。
export const metadata: Metadata = {
  title: "eBayアカウント設定",
  robots: { index: false },
};

export default function EbaySettingsPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/mypage" aria-label="マイページに戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">eBayアカウント設定</span>
          <div className="ml-auto"><AuthButton /></div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-3">
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <h2 className="text-sm font-black text-gray-800 mb-1">eBayの設定（準備・いつでも更新）</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            連携・送料・発送先の国・返品・発送元をここで設定。<b className="text-gray-700">完了後も各STEPからいつでも更新可</b>（送料・発送先の変更もここ）。eBayのパスワードは渡しません。
          </p>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            ※ 連携情報はこの端末（ブラウザ）に暗号化保存。共有端末では使用後にSTEP1で「連携を解除」を。
          </p>
        </section>

        <EbayListingSetup />

        {/* 出品の既定値（発送までの日数を毎回選ばなくて済むように）＝eBay出品の挙動なのでこちらに集約 */}
        <section className="bg-white rounded-2xl p-4 border border-[#A98B5C]/25 shadow-sm">
          <ListingDefaultsSettings />
          <StripBestOfferButton />
        </section>

        <div className="pt-1 text-center">
          <Link href="/settings" className="text-xs text-gray-500 underline hover:text-[#2D323B]">輸出ラボアカウント設定へ</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
