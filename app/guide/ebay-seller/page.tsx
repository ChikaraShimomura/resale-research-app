import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import EbaySellerStepper from "./EbaySellerStepper";

export const metadata = {
  title: "eBayセラー登録ガイド（ステップ式・1つずつ開く） | 輸出ラボ",
  description:
    "eBayで売上を受け取るためのセラー登録を、進むと次が開くステップ式で。①eBayで出品をはじめる→②Payoneer登録＋本人確認(KYC)→③eBayに戻って仕上げる→④準備OKメールでアプリ出品、の4ステップを初見でも迷わず完了できます。",
};

export default function EbaySellerGuidePage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA]">
      <header className="bg-[#BF0000] px-3 py-2.5 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <Link
            href="/guide"
            aria-label="戻る"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0"
          >
            <ArrowLeft size={18} />
          </Link>
          <span className="text-white font-black text-[15px]">eBayセラー登録ガイド</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <EbaySellerStepper />
      </main>
    </div>
  );
}
