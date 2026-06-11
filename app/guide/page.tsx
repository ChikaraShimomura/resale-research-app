import Link from "next/link";
import BottomNav from "../components/BottomNav";

const STEPS = [
  {
    num: "01",
    title: "楽天で商品を仕入れる",
    desc: "このサイトで紹介している利益商品を楽天で購入します。ポイント還元率が高い日（楽天スーパーSALEや0・5のつく日）を狙うとさらにお得です。",
    tips: ["0のつく日・5のつく日はポイント最大5倍", "楽天スーパーSALEは年2回・最大44倍", "SPU（スーパーポイントアッププログラム）でポイント底上げ"],
    color: "bg-[#CC0033]",
  },
  {
    num: "02",
    title: "eBayアカウントを作成する",
    desc: "eBay.comで無料のセラーアカウントを作成します。日本から海外へ発送する「国際発送」に対応した設定が必要です。",
    tips: ["ebay.comでアカウント登録（無料）", "支払い受取はPayoneerまたは銀行口座", "最初の月は手数料無料枠あり"],
    color: "bg-blue-600",
  },
  {
    num: "03",
    title: "eBayに出品する",
    desc: "商品カードの「eBay簡単出品」ボタンを押すと、タイトルが自動入力された出品ページが開きます。説明文・価格・送料を設定して出品完了です。",
    tips: ["価格はeBay平均落札価格を参考に", "送料は¥2,500〜3,000が目安（EMS・ePacket）", "写真は実物を撮影して使用"],
    color: "bg-emerald-600",
  },
  {
    num: "04",
    title: "売れたら発送する",
    desc: "落札後は日本郵便の国際郵便（EMS・ePacket）で発送します。eBayのラベル印刷機能も使えます。",
    tips: ["郵便局の「国際郵便マイページ」で送り状作成", "追跡番号をeBayに登録する", "発送後3〜14日で到着"],
    color: "bg-purple-600",
  },
  {
    num: "05",
    title: "利益を受け取る",
    desc: "落札者が受取確認後、売上がPayoneerや銀行口座に振り込まれます。楽天ポイントは次の仕入れに使えます。",
    tips: ["eBay手数料は落札価格の13.25%＋¥47", "Payoneerから銀行振込（手数料$3程度）", "楽天ポイントは1pt＝1円で使える"],
    color: "bg-orange-500",
  },
];

const FAQS = [
  {
    q: "初期費用はかかりますか？",
    a: "楽天・eBayともにアカウント作成は無料です。仕入れ費用のみ必要です。",
  },
  {
    q: "英語が話せなくても大丈夫ですか？",
    a: "ほぼ不要です。出品タイトルは自動生成、購入者とのやり取りはテンプレートで対応できます。",
  },
  {
    q: "どんな商品が売れますか？",
    a: "ポケモンカード・ガンプラ・LEGO・日本限定フィギュア・日本ブランドの腕時計・コスメが特に人気です。",
  },
  {
    q: "eBayの手数料はいくらですか？",
    a: "落札価格の13.25%＋固定47円です。このサイトの利益計算にはすでに含まれています。",
  },
  {
    q: "楽天ポイントはどう活用しますか？",
    a: "次の仕入れにそのまま使えます。1pt＝1円として楽天市場で利用可能です。",
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      {/* ヘッダー */}
      <header className="bg-[#CC0033]" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">はじめてガイド</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-3 py-4">

        {/* イントロ */}
        <div className="bg-gradient-to-r from-[#CC0033] to-[#E83820] rounded-lg p-4 mb-5 text-white">
          <p className="font-black text-lg mb-1">楽天 × eBay 輸出転売</p>
          <p className="text-white/80 text-sm">楽天でポイントをもらいながら仕入れて、eBayで海外に高く売る副業の始め方を解説します。</p>
        </div>

        {/* ステップ */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-[#CC0033] rounded-full" />
            <h2 className="text-sm font-black text-gray-800">5ステップで始める</h2>
          </div>
          <div className="flex flex-col gap-3">
            {STEPS.map((step) => (
              <div key={step.num} className="bg-white border border-gray-200">
                <div className={`${step.color} px-3 py-2 flex items-center gap-2`}>
                  <span className="text-white font-black text-lg leading-none">STEP {step.num}</span>
                </div>
                <div className="p-3">
                  <h3 className="font-black text-gray-800 text-sm mb-1">{step.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed mb-2">{step.desc}</p>
                  <ul className="space-y-1">
                    {step.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                        <span className="text-[#FF4466] font-bold shrink-0">✓</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 利益計算の説明 */}
        <div className="bg-white border border-gray-200 p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-[#CC0033] rounded-full" />
            <h2 className="text-sm font-black text-gray-800">利益の計算方法</h2>
          </div>
          <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 space-y-1.5 font-mono">
            <div className="flex justify-between"><span>eBay平均落札価格</span><span className="text-blue-600">+ ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天仕入れ価格</span><span className="text-[#CC0033]">- ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天ポイント還元</span><span className="text-[#FF4466]">+ XXXpt</span></div>
            <div className="flex justify-between"><span>eBay手数料（13.25%+¥47）</span><span className="text-[#CC0033]">- ¥XXX</span></div>
            <div className="flex justify-between"><span>国際送料（目安）</span><span className="text-[#CC0033]">- ¥2,500</span></div>
            <div className="flex justify-between font-black text-emerald-600 pt-1.5 border-t border-gray-200 text-sm">
              <span>利益</span><span>= ¥X,XXX + XXXpt</span>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-[#CC0033] rounded-full" />
            <h2 className="text-sm font-black text-gray-800">よくある質問</h2>
          </div>
          <div className="flex flex-col gap-2">
            {FAQS.map((faq, i) => (
              <details key={i} className="bg-white border border-gray-200 rounded-lg group">
                <summary className="flex items-center justify-between gap-2 px-3 min-h-[44px] cursor-pointer list-none text-sm font-bold text-[#CC0033]">
                  <span>Q. {faq.q}</span>
                  <span aria-hidden="true" className="text-gray-400 text-xs shrink-0 transition-transform group-open:rotate-180">▼</span>
                </summary>
                <p className="px-3 pb-3 text-[13px] text-gray-600 leading-relaxed">A. {faq.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center py-4">
          <Link href="/search"
            className="inline-block bg-[#CC0033] text-white font-black px-8 py-3 text-sm">
            利益商品を探す →
          </Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
