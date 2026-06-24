import Link from "next/link";
import { ExternalLink, ShoppingCart, Globe, PenLine, Package, Wallet, ChevronRight, type LucideIcon } from "lucide-react";
import BottomNav from "../components/BottomNav";
import JsonLd from "../components/JsonLd";
import GuideVideo from "../components/GuideVideo";
import RakutenPrepCard from "../components/RakutenPrepCard";
import { ARTICLES } from "./articles";
import { COCONALA_URL, COCONALA_IS_AD } from "../lib/coconala";

export const metadata = {
  title: "楽天×eBay輸出のはじめ方ガイド｜仕入れ→出品→発送→入金を5ステップで",
  description:
    "楽天で仕入れてeBayで売る副業の始め方を、初めてでも分かるように5ステップで解説。eBayセラー登録・出品・国際発送・利益の受け取り（Payoneer）まで、英語ほぼ不要・登録なしで読めます。",
  alternates: { canonical: "/guide" },
};

type Step = {
  num: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
  tips: string[];
  warn?: string;
  link?: { label: string; href: string; external?: boolean };
};

const STEPS: Step[] = [
  {
    num: "1",
    Icon: ShoppingCart,
    title: "楽天で商品を仕入れる",
    desc: "紹介中の利益商品を楽天で購入。ポイント還元率が高い日（0・5のつく日、楽天スーパーSALE）が狙い目。",
    tips: ["0・5のつく日はポイント最大5倍", "楽天スーパーSALEは年2回・最大44倍", "対象サービスで倍率が上がる楽天の仕組み（SPU）でさらに底上げ"],
    link: { label: "利益商品を見る", href: "/search" },
  },
  {
    num: "2",
    Icon: Globe,
    title: "eBayアカウントを作成する",
    desc: "売上を受け取るためのセラー登録（初回だけ）。Payoneer連携と本人確認まで、eBay公式の案内どおりに進める。",
    tips: ["登録は初回の1回だけ", "売上の受け取りはPayoneer（本人確認あり）", "手順はeBay公式が最新。出品はアプリが自動化"],
    link: { label: "eBayでセラー登録する（公式）", href: "https://www.ebay.com/sl/sell", external: true },
  },
  {
    num: "3",
    Icon: PenLine,
    title: "eBayに出品する",
    desc: "商品カードの「eBay自動出品」を押すだけ。タイトル・価格・カテゴリは自動、楽天の画像でそのまま出品。英語不要。",
    tips: ["写真は楽天の画像が自動（実物写真を後から足すと売れやすい）", "カテゴリが赤字なら、タイトルを具体的にして開き直すと通る", "価格・数量・送料サイズは出品後もアプリで編集可"],
    warn: "初回だけ、出品前にアプリ設定でeBay連携・送料／返品ポリシー・発送元住所の登録が必要（数分・次回から不要）。",
    link: { label: "商品を探して出品する", href: "/search" },
  },
  {
    num: "4",
    Icon: Package,
    title: "売れたら発送する",
    desc: "落札後は日本郵便の国際郵便で発送。小型・軽量は「国際エアパケット」（旧・国際eパケットライト／追跡あり・2kgまで）、高額・大きめは「EMS」（追跡＋補償）が定番。海外宛ては内容品を英語で電子申告するため、送り状は「国際郵便マイページ」で作成（2024年から全世界宛てで電子データの事前提出が必須・手書きラベルは原則不可）。",
    tips: ["小型は国際エアパケット／高額・大型はEMS（どちらも追跡あり）", "マイページで送り状＋内容品を英語申告（品名・数量・価格・HSコード）", "追跡番号は必ずeBayの注文に登録（未登録は売上保留・未着クレームの原因）"],
    warn: "国際郵便で送れない物に注意：モバイルバッテリー・リチウム電池単体・香水・アルコール・スプレー・ライター等は航空危険物で発送不可。売れてから気づくと発送できず、未発送ペナルティに。",
    link: { label: "国際郵便マイページを開く", href: "https://www.int-mypage.post.japanpost.jp/", external: true },
  },
  {
    num: "5",
    Icon: Wallet,
    title: "利益を受け取る",
    desc: "売上はeBayからPayoneer（受け取り口座）に入り、そこから日本の銀行口座へ出金。楽天ポイントは次の仕入れにそのまま使える。",
    tips: ["eBay手数料は落札価格の13.25%＋¥47", "売上→Payoneer→銀行の順。反映に数日のラグあり", "楽天ポイントは1pt＝1円で使える"],
    warn: "新規セラーは最初のうち売上が保留（追跡ありは配達確認の数日後／追跡なしは支払いから約1か月）。「売れたのにお金が来ない」は正常。実績がつくと早く受け取れる。",
    link: { label: "売上の受け取り方（出金ガイド）", href: "/guide/payoneer-withdraw" },
  },
];

const FLOW = [
  { Icon: ShoppingCart, label: "楽天で仕入れ", sub: "ポイント還元" },
  { Icon: Globe, label: "eBayで販売", sub: "海外へ高値で" },
  { Icon: Wallet, label: "利益を回収", sub: "売却益＋pt" },
];

const FAQS = [
  { q: "初期費用はかかりますか？", a: "楽天・eBayともアカウント作成は無料。仕入れ費用のみ必要です。" },
  { q: "英語が話せなくても大丈夫ですか？", a: "ほぼ不要。出品タイトルは自動生成、購入者とのやり取りもテンプレートで対応できます。" },
  { q: "どんな商品が売れますか？", a: "ポケモンカード・ガンプラ・LEGO・日本限定フィギュア・日本ブランドの腕時計・コスメが特に人気。ただし香水・スプレー・電池内蔵品などは国際郵便で送れないことがあるので、仕入れ前に発送可否を確認しましょう。" },
  { q: "売れたのに口座にお金が来ません。", a: "新規セラーは最初のうち売上が保留されます（追跡ありなら配達確認の数日後、追跡なしは支払いから約1か月）。これは正常。追跡番号をeBayに登録し、出品実績がつくと早く受け取れます。" },
  { q: "出品できる数が少ない・増やせません。", a: "新規セラーには出品上限（目安：月10品・合計500ドル）があります。実績がつくと自動で引き上げられ、マイeBayから引き上げ申請も可能（30日に1回）。" },
  { q: "海外に送れない商品はありますか？", a: "モバイルバッテリー・リチウム電池単体・香水・アルコール・スプレー・ライターなどは航空危険物で、国際郵便では送れません。仕入れ前に確認を。" },
  { q: "返品不可にすれば返金リスクはありませんか？", a: "いいえ。返品不可でも、未着や「説明と違う」商品はeBayの保証（Money Back Guarantee）で返金・返品の対象になります。追跡付きで発送し、正直な商品説明で身を守りましょう。" },
  { q: "eBayの手数料はいくらですか？", a: "落札価格の13.25%＋固定47円。このサイトの利益計算には算入済みです。" },
  { q: "楽天ポイントはどう活用しますか？", a: "次の仕入れにそのまま使えます。1pt＝1円として楽天市場で利用可。" },
];

const SITE_URL = "https://www.yushutsu-fukugyo.com";

// FAQ構造化データ（検索結果でのリッチ表示用）
const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

// 手順（HowTo）構造化データ。5ステップをそのままリッチリザルト候補にする。
const HOWTO_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "楽天で仕入れてeBayで売る手順",
  description: "楽天で日本の人気商品を仕入れ、eBayで海外に販売して利益を得るまでの5ステップ。",
  step: STEPS.map((s, i) => ({
    "@type": "HowToStep",
    position: i + 1,
    name: s.title,
    text: s.desc,
    url: `${SITE_URL}/guide#step-${s.num}`,
  })),
};

// パンくず（BreadcrumbList）。検索結果のパンくず表示＝クリック率向上。
const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "ホーム", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "ガイド", item: `${SITE_URL}/guide` },
  ],
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-5 bg-[#2D323B] rounded-full" />
      <h2 className="text-sm font-black text-gray-800">{children}</h2>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <JsonLd data={FAQ_LD} />
      <JsonLd data={HOWTO_LD} />
      <JsonLd data={BREADCRUMB_LD} />
      {/* ヘッダー */}
      <header className="bg-[#2D323B] sticky top-0 z-20 shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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
        <div className="bg-gradient-to-br from-[#2D323B] to-[#1A1D23] rounded-2xl p-5 mb-6 text-white shadow-sm">
          <p className="font-black text-xl mb-1.5">楽天 × eBay 輸出転売</p>
          <p className="text-white/85 text-[13px] leading-relaxed mb-5">
            楽天でポイントをもらいながら仕入れ、eBayで海外に高く売る副業の始め方を、初めての方向けに解説。
          </p>
          <div className="flex items-stretch gap-2">
            {FLOW.map((f, i) => (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div className="flex-1 bg-white/15 rounded-xl px-1 py-3 text-center backdrop-blur-sm">
                  <f.Icon size={20} strokeWidth={2} className="mx-auto mb-1.5 text-white" />
                  <div className="text-[11px] font-black leading-tight">{f.label}</div>
                  <div className="text-[9px] text-white/70 leading-tight mt-0.5">{f.sub}</div>
                </div>
                {i < FLOW.length - 1 && <span aria-hidden="true" className="text-white/60 text-sm shrink-0">›</span>}
              </div>
            ))}
          </div>
        </div>

        {/* 全体像の動画 */}
        <div className="mb-6">
          <SectionTitle>まずは動画で全体像</SectionTitle>
          <GuideVideo
            title="楽天×eBay 輸出転売のはじめ方"
            src="/videos/guide-overview.mp4"
            poster="/videos/guide-overview-poster.jpg"
            durationLabel="約1分"
            note="※ 仕入れ→出品→発送→入金の流れを、やさしい音声ナレーションつきでまとめています。"
          />
        </div>

        {/* 手順の動画（eBay登録・出金）。ホームの「eBay登録・出金の動画も見る →」の着地。 */}
        <div className="mb-6">
          <SectionTitle>動画で手順を見る</SectionTitle>
          <div className="flex flex-col gap-4">
            <GuideVideo
              title="eBayのセラー登録のしかた"
              src="/videos/ebay-seller-guide.mp4"
              poster="/videos/ebay-seller-guide-poster.jpg"
              durationLabel="約2分"
              note="※ 最初の難所＝eBayのセラー登録の流れを、画面つきで解説。"
            />
            <GuideVideo
              title="売上の受け取り（Payoneer出金）"
              src="/videos/payoneer-withdraw-guide.mp4"
              poster="/videos/payoneer-withdraw-guide-poster.jpg"
              durationLabel="約1分"
              note="※ eBayの売上をPayoneer経由で日本の銀行口座に出金する流れ。"
            />
          </div>
        </div>

        {/* 始める前の準備（楽天経済圏でポイント＝利益を底上げ） */}
        <div className="mb-6">
          <SectionTitle>始める前の準備</SectionTitle>
          <RakutenPrepCard />
        </div>

        {/* ステップ */}
        <div className="mb-6">
          <SectionTitle>5ステップで始める</SectionTitle>
          <div className="flex flex-col gap-3.5">
            {STEPS.map((step) => (
              <div key={step.num} id={`step-${step.num}`} className="scroll-mt-20 bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#A98B5C]/15">
                  <span className="w-8 h-8 rounded-full bg-[#2D323B] text-white font-black flex items-center justify-center text-sm shrink-0">
                    {step.num}
                  </span>
                  <h3 className="font-black text-gray-800 text-[15px] flex items-center gap-1.5">
                    <step.Icon size={17} strokeWidth={2} className="text-gray-500 shrink-0" />{step.title}
                  </h3>
                </div>
                <div className="px-4 py-4">
                  <p className="text-[13px] text-gray-600 leading-relaxed mb-3.5">{step.desc}</p>
                  <ul className="space-y-2 mb-4">
                    {step.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px] text-gray-600 leading-snug">
                        <span aria-hidden="true" className="w-4 h-4 mt-0.5 rounded-full bg-[#2D323B]/10 text-[#2D323B] text-[10px] font-black flex items-center justify-center shrink-0">✓</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                  {step.warn && (
                    <div className="flex items-start gap-2 bg-[#2D323B]/[0.05] border border-[#2D323B]/20 rounded-xl px-3 py-2.5 mb-4">
                      <span aria-hidden="true" className="text-[#2D323B] text-sm leading-none mt-0.5 shrink-0">⚠️</span>
                      <p className="text-[12px] text-[#2D323B] leading-relaxed font-medium">{step.warn}</p>
                    </div>
                  )}
                  {step.link && (
                    step.link.external ? (
                      <a href={step.link.href} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#2D323B] bg-[#2D323B]/5 border border-[#2D323B]/20 rounded-xl px-3.5 py-2 active:bg-[#2D323B]/10 transition-colors">
                        {step.link.label} <ExternalLink size={13} />
                      </a>
                    ) : (
                      <Link href={step.link.href}
                        className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#2D323B] bg-[#2D323B]/5 border border-[#2D323B]/20 rounded-xl px-3.5 py-2 active:bg-[#2D323B]/10 transition-colors">
                        {step.link.label} →
                      </Link>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 読み物・コラム（SEO大黒柱記事への内部リンク） */}
        <div className="mb-6">
          <SectionTitle>もっと詳しく（記事で読む）</SectionTitle>
          <div className="flex flex-col gap-2">
            {ARTICLES.map((a) => (
              <Link key={a.slug} href={`/guide/${a.slug}`}
                className="block bg-white border border-[#A98B5C]/25 rounded-2xl px-4 py-3.5 shadow-sm active:bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-gray-800 leading-snug flex-1 min-w-0">{a.title}</span>
                  <ChevronRight size={16} className="text-gray-400 shrink-0" />
                </div>
                {/* 冒頭(lead)を2行プレビュー＝どの記事が自分の悩みに効くか判り回遊が上がる(lead は静的・ビルド時完結) */}
                <p className="text-[11px] text-gray-500 leading-relaxed mt-1 line-clamp-2">{a.lead}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* 利益計算の説明 */}
        <div className="mb-6">
          <SectionTitle>利益の計算方法</SectionTitle>
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
            <div className="bg-[#F5F7FA] rounded-xl p-3 text-xs text-gray-600 space-y-1.5 font-mono">
              <div className="flex justify-between"><span>eBay相場価格</span><span className="text-blue-600">+ ¥XX,XXX</span></div>
              <div className="flex justify-between"><span>楽天仕入れ価格</span><span className="text-[#2D323B]">- ¥XX,XXX</span></div>
              <div className="flex justify-between"><span>eBay手数料（13.25%＋¥47）</span><span className="text-[#2D323B]">- ¥XXX</span></div>
              <div className="flex justify-between"><span>国際送料</span><span className="text-emerald-600 font-bold">購入者負担</span></div>
              <div className="flex justify-between"><span>米国関税（$100超）</span><span className="text-[#2D323B]">- 目安を差引</span></div>
              <div className="flex justify-between font-black text-emerald-600 pt-1.5 border-t border-[#A98B5C]/35 text-sm">
                <span>利益（現金）</span><span>= ¥X,XXX</span>
              </div>
              <div className="flex justify-between text-[#FF4466] font-bold">
                <span>＋ 楽天ポイント（おまけ・別枠）</span><span>+ XXXポイント</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 text-center mt-2.5">利益は現金（円）で算出。楽天ポイントは利益に含めず別表示（おまけ）。国際送料は購入者負担、$100超の米国関税と送料分のeBay手数料は出品者負担として差引済み。</p>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-5">
          <SectionTitle>よくある質問</SectionTitle>
          <div className="flex flex-col gap-2">
            {FAQS.map((faq, i) => (
              <details key={i} className="bg-white border border-[#A98B5C]/25 rounded-2xl shadow-sm group">
                <summary className="flex items-center justify-between gap-2 px-4 min-h-[52px] cursor-pointer list-none text-[14px] font-bold text-gray-800">
                  <span><span className="text-[#2D323B]">Q.</span> {faq.q}</span>
                  <span aria-hidden="true" className="text-gray-400 text-xs shrink-0 transition-transform group-open:rotate-180">▼</span>
                </summary>
                <p className="px-4 pb-4 text-[13px] text-gray-600 leading-relaxed">A. {faq.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center py-2">
          <Link href="/search"
            className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:scale-[0.99] text-white font-black px-8 py-3 text-sm rounded-full shadow-md transition-all">
            利益商品を探す →
          </Link>
        </div>

        {/* 個別サポート（任意・非楽天）。eBayセラー登録(最初の1回が最大の難所)で詰まった時だけ他社に相談。 */}
        <p className="text-center text-[12px] text-gray-500 leading-relaxed mt-4">
          海外輸出いちばんの難所が<b className="text-gray-700">eBayのセラー登録（最初の1回だけ）</b>。詰まったら{" "}
          <a href={COCONALA_URL} target="_blank" rel="nofollow sponsored noopener noreferrer" className="font-bold text-[#2D323B] underline underline-offset-2">
            ココナラで個別サポート{COCONALA_IS_AD ? "（広告）" : ""}
          </a>
          {" "}で数千円からベテランに手伝ってもらえます。
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
