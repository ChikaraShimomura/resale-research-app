import Link from "next/link";
import { ExternalLink, ShoppingCart, Globe, PenLine, Package, Wallet, type LucideIcon } from "lucide-react";
import BottomNav from "../components/BottomNav";

type Step = {
  num: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
  tips: string[];
  link?: { label: string; href: string; external?: boolean };
};

const STEPS: Step[] = [
  {
    num: "1",
    Icon: ShoppingCart,
    title: "楽天で商品を仕入れる",
    desc: "このサイトで紹介している利益商品を楽天で購入します。ポイント還元率が高い日（0・5のつく日や楽天スーパーSALE）を狙うとさらにお得です。",
    tips: ["0のつく日・5のつく日はポイント最大5倍", "楽天スーパーSALEは年2回・最大44倍", "SPU（スーパーポイントアッププログラム）でポイント底上げ"],
    link: { label: "利益商品を見る", href: "/search" },
  },
  {
    num: "2",
    Icon: Globe,
    title: "eBayアカウントを作成する",
    desc: "eBay.comで無料のセラーアカウントを作成します。日本から海外へ発送する「国際発送」に対応した設定にしておきます。",
    tips: ["ebay.comでアカウント登録（無料）", "支払い受取はPayoneerまたは銀行口座", "最初は出品数に無料枠あり"],
    link: { label: "eBay.comで無料登録", href: "https://www.ebay.com/", external: true },
  },
  {
    num: "3",
    Icon: PenLine,
    title: "eBayに出品する",
    desc: "商品カードの「eBay簡単出品」ボタンを押すと、タイトルが自動入力された出品ページが開きます。あとは説明文・価格・送料を設定するだけです。",
    tips: ["価格はeBay相場価格を参考に", "送料は¥2,500〜3,000が目安（EMS・ePacket）", "写真は実物を撮影して使用"],
    link: { label: "商品を探して出品する", href: "/search" },
  },
  {
    num: "4",
    Icon: Package,
    title: "売れたら発送する",
    desc: "落札後は日本郵便の国際郵便（EMS・ePacket）で発送します。「国際郵便マイページ」で送り状を作成でき、ラベル印刷も簡単です。",
    tips: ["国際郵便マイページで送り状を作成", "追跡番号をeBayに登録する", "発送後3〜14日で到着"],
    link: { label: "国際郵便マイページを開く", href: "https://www.int-mypage.post.japanpost.jp/", external: true },
  },
  {
    num: "5",
    Icon: Wallet,
    title: "利益を受け取る",
    desc: "落札者の受取確認後、売上がPayoneerや銀行口座に振り込まれます。楽天ポイントは次の仕入れにそのまま使えます。",
    tips: ["eBay手数料は落札価格の13.25%＋¥47", "Payoneerから日本の銀行へ振込", "楽天ポイントは1pt＝1円で使える"],
    link: { label: "Payoneer（受取サービス）", href: "https://www.payoneer.com/ja/", external: true },
  },
];

const FLOW = [
  { Icon: ShoppingCart, label: "楽天で仕入れ", sub: "ポイント還元" },
  { Icon: Globe, label: "eBayで販売", sub: "海外へ高値で" },
  { Icon: Wallet, label: "利益を回収", sub: "売却益＋pt" },
];

const FAQS = [
  { q: "初期費用はかかりますか？", a: "楽天・eBayともにアカウント作成は無料です。仕入れ費用のみ必要です。" },
  { q: "英語が話せなくても大丈夫ですか？", a: "ほぼ不要です。出品タイトルは自動生成され、購入者とのやり取りもテンプレートで対応できます。" },
  { q: "どんな商品が売れますか？", a: "ポケモンカード・ガンプラ・LEGO・日本限定フィギュア・日本ブランドの腕時計・コスメが特に人気です。" },
  { q: "eBayの手数料はいくらですか？", a: "落札価格の13.25%＋固定47円です。このサイトの利益計算にはすでに含まれています。" },
  { q: "楽天ポイントはどう活用しますか？", a: "次の仕入れにそのまま使えます。1pt＝1円として楽天市場で利用できます。" },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-5 bg-[#BF0000] rounded-full" />
      <h2 className="text-sm font-black text-gray-800">{children}</h2>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      {/* ヘッダー */}
      <header className="bg-[#BF0000] sticky top-0 z-20 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/search" aria-label="検索に戻る"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">はじめてガイド</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 py-4">

        {/* イントロ + フロー図 */}
        <div className="bg-gradient-to-br from-[#BF0000] to-[#9E0000] rounded-2xl p-4 mb-5 text-white shadow-sm">
          <p className="font-black text-lg mb-1">楽天 × eBay 輸出転売</p>
          <p className="text-white/85 text-[13px] leading-relaxed mb-4">
            楽天でポイントをもらいながら仕入れて、eBayで海外に高く売る副業の始め方を、初めての方向けに解説します。
          </p>
          <div className="flex items-stretch gap-1.5">
            {FLOW.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-1">
                <div className="flex-1 bg-white/15 rounded-xl px-1 py-2.5 text-center backdrop-blur-sm">
                  <f.Icon size={20} strokeWidth={2} className="mx-auto mb-1.5 text-white" />
                  <div className="text-[11px] font-black leading-tight">{f.label}</div>
                  <div className="text-[9px] text-white/70 leading-tight mt-0.5">{f.sub}</div>
                </div>
                {i < FLOW.length - 1 && <span aria-hidden="true" className="text-white/60 text-sm shrink-0">›</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ステップ */}
        <div className="mb-6">
          <SectionTitle>5ステップで始める</SectionTitle>
          <div className="flex flex-col gap-3">
            {STEPS.map((step) => (
              <div key={step.num} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-3.5 py-3 border-b border-gray-50">
                  <span className="w-8 h-8 rounded-full bg-[#BF0000] text-white font-black flex items-center justify-center text-sm shrink-0">
                    {step.num}
                  </span>
                  <h3 className="font-black text-gray-800 text-[15px] flex items-center gap-1.5">
                    <step.Icon size={17} strokeWidth={2} className="text-gray-500 shrink-0" />{step.title}
                  </h3>
                </div>
                <div className="px-3.5 py-3">
                  <p className="text-[13px] text-gray-600 leading-relaxed mb-3">{step.desc}</p>
                  <ul className="space-y-1.5 mb-3">
                    {step.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-gray-600 leading-snug">
                        <span aria-hidden="true" className="w-4 h-4 mt-0.5 rounded-full bg-[#BF0000]/10 text-[#BF0000] text-[10px] font-black flex items-center justify-center shrink-0">✓</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                  {step.link && (
                    step.link.external ? (
                      <a href={step.link.href} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#BF0000] bg-[#BF0000]/5 border border-[#BF0000]/20 rounded-lg px-3 py-2 active:bg-[#BF0000]/10 transition-colors">
                        {step.link.label} <ExternalLink size={13} />
                      </a>
                    ) : (
                      <Link href={step.link.href}
                        className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#BF0000] bg-[#BF0000]/5 border border-[#BF0000]/20 rounded-lg px-3 py-2 active:bg-[#BF0000]/10 transition-colors">
                        {step.link.label} →
                      </Link>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 利益計算の説明 */}
        <div className="mb-6">
          <SectionTitle>利益の計算方法</SectionTitle>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className="bg-[#F5F7FA] rounded-xl p-3 text-xs text-gray-600 space-y-1.5 font-mono">
              <div className="flex justify-between"><span>eBay相場価格</span><span className="text-blue-600">+ ¥XX,XXX</span></div>
              <div className="flex justify-between"><span>楽天仕入れ価格</span><span className="text-[#BF0000]">- ¥XX,XXX</span></div>
              <div className="flex justify-between"><span>楽天ポイント還元</span><span className="text-[#FF4466]">+ XXXpt</span></div>
              <div className="flex justify-between"><span>eBay手数料（13.25%＋¥47）</span><span className="text-[#BF0000]">- ¥XXX</span></div>
              <div className="flex justify-between"><span>国際送料</span><span className="text-emerald-600 font-bold">購入者負担</span></div>
              <div className="flex justify-between font-black text-emerald-600 pt-1.5 border-t border-gray-200 text-sm">
                <span>利益</span><span>= ¥X,XXX ＋ XXXpt</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 text-center mt-2.5">全商品この計算式で利益を算出しています（国際送料は購入者負担のため利益に含めません）</p>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-5">
          <SectionTitle>よくある質問</SectionTitle>
          <div className="flex flex-col gap-2">
            {FAQS.map((faq, i) => (
              <details key={i} className="bg-white border border-gray-100 rounded-2xl shadow-sm group">
                <summary className="flex items-center justify-between gap-2 px-3.5 min-h-[48px] cursor-pointer list-none text-[14px] font-bold text-gray-800">
                  <span><span className="text-[#BF0000]">Q.</span> {faq.q}</span>
                  <span aria-hidden="true" className="text-gray-400 text-xs shrink-0 transition-transform group-open:rotate-180">▼</span>
                </summary>
                <p className="px-3.5 pb-3.5 text-[13px] text-gray-600 leading-relaxed">A. {faq.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center py-2">
          <Link href="/search"
            className="inline-block bg-[#BF0000] hover:bg-[#9E0000] active:scale-[0.99] text-white font-black px-8 py-3 text-sm rounded-full shadow-md transition-all">
            利益商品を探す →
          </Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
