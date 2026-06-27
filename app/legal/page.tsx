import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import { PLANS, TRIAL_DAYS } from "../lib/plans";

// 特定商取引法に基づく表記（有料サービス＝必須）。
// ⚠️ これは叩き台です。本番公開前に行政書士・弁護士の確認を推奨。
// 個人情報（氏名・住所・電話）はコードに直書きせず env で持つ。住所・電話は未設定なら
// 「請求があれば遅滞なく開示」（通信販売で認められた省略方式）にフォールバック＝自宅を出したくない個人事業主向け。
export const metadata: Metadata = {
  title: "特定商取引法に基づく表記",
  description: "輸出ラボ（有料プラン）の特定商取引法に基づく表記。事業者情報・販売価格・支払方法・解約/返金について。",
  alternates: { canonical: "https://www.yushutsu-fukugyo.com/legal" },
  robots: { index: false },
};

// 事業者情報の env(LEGAL_*) を実行時に読む＝envを入れたら再ビルド無しでも反映（静的焼き付き回避）。
export const dynamic = "force-dynamic";

const ON_REQUEST = "ご請求があれば遅滞なく開示いたします（お問い合わせはメールにて受付）。";
const OPERATOR = process.env.LEGAL_OPERATOR_NAME?.trim() || "（準備中：env LEGAL_OPERATOR_NAME に氏名を設定）";
const ADDRESS = process.env.LEGAL_ADDRESS?.trim() || ON_REQUEST;
const PHONE = process.env.LEGAL_PHONE?.trim() || ON_REQUEST;
const CONTACT = process.env.LEGAL_CONTACT_EMAIL?.trim() || "support@yushutsu-fukugyo.com";

const yen = (n: number) => `月額 ¥${n.toLocaleString()}（税込）`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="border-t border-[#A98B5C]/15 align-top">
      <th className="text-left font-bold text-gray-700 py-3 pr-3 w-[38%] text-[13px]">{label}</th>
      <td className="py-3 text-[13px] text-gray-700 leading-relaxed">{children}</td>
    </tr>
  );
}

export default function LegalPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#2D323B] sticky top-0 z-20 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/" aria-label="戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">特定商取引法に基づく表記</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-3">
        <article className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
          <table className="w-full border-collapse">
            <tbody>
              <Row label="販売事業者">{OPERATOR}</Row>
              <Row label="運営統括責任者">{OPERATOR}</Row>
              <Row label="所在地">{ADDRESS}</Row>
              <Row label="電話番号">{PHONE}</Row>
              <Row label="メールアドレス">{CONTACT}</Row>
              <Row label="販売URL">https://www.yushutsu-fukugyo.com</Row>
              <Row label="販売価格">
                ライト：{yen(PLANS.amateur.priceJpy)}（同時出品 {PLANS.amateur.listingLimit}件まで）<br />
                スタンダード：{yen(PLANS.veteran.priceJpy)}（同時出品 {PLANS.veteran.listingLimit}件まで）<br />
                プロ：{yen(PLANS.pro.priceJpy)}（同時出品 {PLANS.pro.listingLimit}件まで）
              </Row>
              <Row label="商品代金以外に必要な料金">
                <span className="whitespace-nowrap">サービス利用料以外に</span><wbr />
                <span className="whitespace-nowrap">当方が請求する費用はありません。</span><br />
                <span className="whitespace-nowrap">※ 中古品の仕入れ費用（中古サイト等）、</span><wbr />
                <span className="whitespace-nowrap">eBay等の販売手数料・送料・関税などは</span><wbr />
                <span className="whitespace-nowrap">利用者負担</span><wbr />
                <span className="whitespace-nowrap">（本サービス料金には含まれません）。</span>
              </Row>
              <Row label="無料トライアル">
                <span className="whitespace-nowrap">ライトプランは初回 {TRIAL_DAYS} 日間無料。</span><wbr />
                <span className="whitespace-nowrap">期間内の解約なら</span><wbr />
                <span className="whitespace-nowrap">料金は一切発生しません。</span>
              </Row>
              <Row label="お支払い方法">クレジットカード（決済代行：Stripe）</Row>
              <Row label="お支払い時期">
                <span className="whitespace-nowrap">お申し込み時に課金、</span><wbr />
                <span className="whitespace-nowrap">以降は毎月同日に自動更新</span><wbr />
                <span className="whitespace-nowrap">（ライトは無料期間の終了後に初回課金）。</span>
              </Row>
              <Row label="サービスの提供時期">決済完了後、ただちにご利用いただけます。</Row>
              <Row label="解約・自動更新の停止">
                <span className="whitespace-nowrap">いつでも解約可。</span><wbr />
                <Link href="/faq" className="text-[#2D323B] underline whitespace-nowrap">よくある質問の「解約・プラン変更の方法」</Link>
                <span className="whitespace-nowrap">（または設定）から、</span><wbr />
                <span className="whitespace-nowrap">Stripeの管理画面で</span><wbr />
                <span className="whitespace-nowrap">お手続きください。</span><wbr />
                <span className="whitespace-nowrap">解約後は次回更新日以降の</span><wbr />
                <span className="whitespace-nowrap">課金は行われません。</span>
              </Row>
              <Row label="返品・返金について">
                <span className="whitespace-nowrap">サービスの性質上（デジタルサービス）、</span><wbr />
                <span className="whitespace-nowrap">決済済みの月額料金は</span><wbr />
                <span className="whitespace-nowrap">日割り返金・返金を</span><wbr />
                <span className="whitespace-nowrap">原則行っておりません。</span><wbr />
                <span className="whitespace-nowrap">無料トライアル期間中の解約なら</span><wbr />
                <span className="whitespace-nowrap">課金されません。</span>
              </Row>
              <Row label="動作環境">一般的なWebブラウザ（最新版のChrome / Safari 等）。</Row>
            </tbody>
          </table>

          <p className="mt-6 text-[12px] text-gray-400 leading-relaxed">
            <span className="whitespace-nowrap">※ 本表記は叩き台です。</span><wbr />
            <span className="whitespace-nowrap">本番運用前に</span><wbr />
            <span className="whitespace-nowrap">行政書士・弁護士のご確認を推奨。</span><br />
            <span className="whitespace-nowrap">制定日：2026年6月21日</span><wbr />
            <span className="whitespace-nowrap"> ／ お問い合わせ：{CONTACT}</span>
          </p>
          <div className="mt-3 flex gap-3">
            <Link href="/terms" className="text-[12px] text-gray-500 underline">利用規約</Link>
            <Link href="/privacy" className="text-[12px] text-gray-500 underline">プライバシーポリシー</Link>
          </div>
        </article>
      </main>

      <BottomNav />
    </div>
  );
}
