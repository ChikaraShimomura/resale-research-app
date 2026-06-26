import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import PortalButton from "../components/PortalButton";
import { PLANS, TRIAL_DAYS } from "../lib/plans";

// よくある質問。解約方法もここに置き、PortalButton から手続きできるようにする（解約導線は隠さず"目立たせない"）。
export const metadata: Metadata = {
  title: "よくある質問",
  description: "輸出ラボのよくある質問。料金・無料トライアル・支払い方法・解約/プラン変更の方法など。",
  alternates: { canonical: "https://www.yushutsu-fukugyo.com/faq" },
};

const yen = (n: number) => `月額 ¥${n.toLocaleString()}（税込）`;

function QA({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm overflow-hidden">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3.5 active:bg-gray-50">
        <span className="text-[14px] font-bold text-gray-800">{q}</span>
        <span className="text-gray-400 transition-transform group-open:rotate-180 shrink-0">⌄</span>
      </summary>
      <div className="px-4 pb-4 pt-1 text-[13px] text-gray-600 leading-relaxed space-y-2">{children}</div>
    </details>
  );
}

export default function FaqPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#2D323B] sticky top-0 z-20 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/" aria-label="戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">よくある質問</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3 space-y-2.5">
        <QA q="料金プランは？">
          <p>使う量に合わせて3プラン（いずれも月額・税込）。</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>ライト：{yen(PLANS.amateur.priceJpy)}（同時出品 {PLANS.amateur.listingLimit}件まで）</li>
            <li>スタンダード：{yen(PLANS.veteran.priceJpy)}（同時出品 {PLANS.veteran.listingLimit}件まで）</li>
            <li>プロ：{yen(PLANS.pro.priceJpy)}（同時出品 {PLANS.pro.listingLimit}件まで）</li>
          </ul>
          <p><Link href="/pricing" className="text-[#2D323B] underline">料金ページ</Link>から申し込み。</p>
        </QA>

        <QA q="無料で試せますか？">
          <p>ライトプランは最初の {TRIAL_DAYS} 日間無料。期間内に解約すれば料金は一切発生しません。</p>
        </QA>

        <QA q="支払い方法は？">
          <p>クレジットカードのみ（決済代行：Stripe）。申し込み時に登録、以降は毎月自動更新。</p>
        </QA>

        <QA q="解約・プラン変更の方法は？">
          <p>いつでも解約・プラン変更OK。下のボタンから管理画面（Stripe）で手続き。</p>
          <p>解約しても<b className="text-gray-700">請求期間の終了まで利用可</b>、それ以降は課金されません。無料トライアル中の解約なら料金は発生しません。</p>
          <div className="pt-1">
            <PortalButton />
          </div>
          <p className="text-[12px] text-gray-400">※ 設定ページの「ご契約の管理・解約について」からも同じ手続き可。</p>
        </QA>

        <QA q="仕入れやeBayの費用も料金に含まれますか？">
          <p>いいえ。利用料に含まれるのはツールの利用権のみ。中古品の仕入れ費用（中古サイト等）、eBayの販売手数料・送料・関税などは利用者のご負担です。</p>
        </QA>

        <div className="pt-3 flex items-center justify-center gap-3 flex-wrap">
          <Link href="/legal" className="text-[11px] text-gray-400 underline">特定商取引法に基づく表記</Link>
          <Link href="/terms" className="text-[11px] text-gray-400 underline">利用規約</Link>
          <Link href="/privacy" className="text-[11px] text-gray-400 underline">プライバシー</Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
