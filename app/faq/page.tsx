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
          <p>
            <span className="whitespace-nowrap">使う量に合わせて4プラン</span><wbr />
            <span className="whitespace-nowrap">（いずれも月額・税込）。</span>
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>カタログ閲覧：{yen(PLANS.viewer.priceJpy)}（カタログ閲覧のみ・出品/操作は不可）</li>
            <li>ライト：{yen(PLANS.amateur.priceJpy)}（同時出品 {PLANS.amateur.listingLimit}件まで）</li>
            <li>スタンダード：{yen(PLANS.veteran.priceJpy)}（同時出品 {PLANS.veteran.listingLimit}件まで）</li>
            <li>プロ：{yen(PLANS.pro.priceJpy)}（同時出品 {PLANS.pro.listingLimit}件まで）</li>
          </ul>
          <p><Link href="/pricing" className="text-[#2D323B] underline">料金ページ</Link>から申し込み。</p>
        </QA>

        <QA q="無料で試せますか？">
          <p>
            <span className="whitespace-nowrap">ライトとカタログ閲覧は</span><wbr />
            <span className="whitespace-nowrap">最初の {TRIAL_DAYS} 日間無料。</span><wbr />
            <span className="whitespace-nowrap">期間内に解約すれば</span><wbr />
            <span className="whitespace-nowrap">料金は一切発生しません。</span>
          </p>
        </QA>

        <QA q="支払い方法は？">
          <p>
            <span className="whitespace-nowrap">クレジットカードのみ</span><wbr />
            <span className="whitespace-nowrap">（決済代行：Stripe）。</span><wbr />
            <span className="whitespace-nowrap">申し込み時に登録、</span><wbr />
            <span className="whitespace-nowrap">以降は毎月自動更新。</span>
          </p>
        </QA>

        <QA q="解約・プラン変更の方法は？">
          <p>
            <span className="whitespace-nowrap">いつでも解約・プラン変更OK。</span><wbr />
            <span className="whitespace-nowrap">下のボタンから</span><wbr />
            <span className="whitespace-nowrap">管理画面（Stripe）で手続き。</span>
          </p>
          <p>
            <span className="whitespace-nowrap">解約しても</span><wbr />
            <b className="text-gray-700 whitespace-nowrap">請求期間の終了まで利用可</b><wbr />
            <span className="whitespace-nowrap">、それ以降は課金されません。</span><wbr />
            <span className="whitespace-nowrap">無料トライアル中の解約なら</span><wbr />
            <span className="whitespace-nowrap">料金は発生しません。</span>
          </p>
          <div className="pt-1">
            <PortalButton />
          </div>
          <p className="text-[12px] text-gray-400">
            <span className="whitespace-nowrap">※ 設定ページの</span><wbr />
            <span className="whitespace-nowrap">「ご契約の管理・解約について」</span><wbr />
            <span className="whitespace-nowrap">からも同じ手続き可。</span>
          </p>
        </QA>

        <QA q="仕入れやeBayの費用も料金に含まれますか？">
          <p>
            <span className="whitespace-nowrap">いいえ。利用料に含まれるのは</span><wbr />
            <span className="whitespace-nowrap">ツールの利用権のみ。</span><wbr />
            <span className="whitespace-nowrap">中古品の仕入れ費用（中古サイト等）、</span><wbr />
            <span className="whitespace-nowrap">eBayの販売手数料・送料・関税などは</span><wbr />
            <span className="whitespace-nowrap">利用者のご負担です。</span>
          </p>
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
