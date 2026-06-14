import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import EbaySellerStepper from "./EbaySellerStepper";
import GuideVideo from "../../components/GuideVideo";
import GuideVideoShorts from "../../components/GuideVideoShorts";

export const metadata = {
  title: "eBayセラー登録ガイド（ステップ式・1つずつ開く） | 輸出ラボ",
  description:
    "eBayで売上を受け取るためのセラー登録を、進むと次が開くステップ式で。①eBayで出品をはじめる→②Payoneer登録＋本人確認(KYC)→③eBayに戻って仕上げる→④準備OKメールでアプリ出品、の4ステップを初見でも迷わず完了できます。",
  alternates: { canonical: "/guide/ebay-seller" },
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

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <GuideVideo
          title="動画で先に流れをつかむ（つまずき対策つき）"
          src="/videos/ebay-seller-guide.mp4"
          poster="/videos/ebay-seller-guide-poster.jpg"
          durationLabel="約2分"
          note="※ やさしい音声ナレーションつき。手が止まったら、この動画の同じ場面に戻ると解決できます。"
        />
        <GuideVideoShorts
          title="STEPごとに分けて見る（短い動画）"
          note="つまずいた所だけ、サッと見直せます。"
          shorts={[
            { label: "用意するもの", src: "/videos/shorts/ebay-seller-guide-intro.mp4", poster: "/videos/shorts/ebay-seller-guide-intro-poster.jpg", durationLabel: "16秒" },
            { label: "① 出品をはじめる", src: "/videos/shorts/ebay-seller-guide-step1.mp4", poster: "/videos/shorts/ebay-seller-guide-step1-poster.jpg", durationLabel: "24秒" },
            { label: "② Payoneer登録", src: "/videos/shorts/ebay-seller-guide-step2.mp4", poster: "/videos/shorts/ebay-seller-guide-step2-poster.jpg", durationLabel: "52秒" },
            { label: "③ 仕上げ", src: "/videos/shorts/ebay-seller-guide-step3.mp4", poster: "/videos/shorts/ebay-seller-guide-step3-poster.jpg", durationLabel: "24秒" },
            { label: "④ 出品する", src: "/videos/shorts/ebay-seller-guide-step4.mp4", poster: "/videos/shorts/ebay-seller-guide-step4-poster.jpg", durationLabel: "19秒" },
            { label: "困ったとき", src: "/videos/shorts/ebay-seller-guide-trouble.mp4", poster: "/videos/shorts/ebay-seller-guide-trouble-poster.jpg", durationLabel: "26秒" },
          ]}
        />
        <EbaySellerStepper />
      </main>
    </div>
  );
}
