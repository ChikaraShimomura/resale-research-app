import Link from "next/link";
import { ArrowLeft, ShoppingBag, Sparkles, Calendar, AlertTriangle, Check, Coins } from "lucide-react";

export const metadata = {
  title: "楽天で仕入れる（仕入れガイド） | 輸出ラボ",
  description:
    "輸出ラボの「仕入れ先」が楽天です。日本の人気商品をポイント還元つきでお得に仕入れる方法を、初心者向けに解説。0と5のつく日・スーパーSALE・SPUでポイントを最大化し、実質コストを下げて利益を増やすコツをまとめました。",
  alternates: { canonical: "/guide/rakuten" },
};

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px] text-gray-600 leading-snug">
      <span aria-hidden="true" className="w-4 h-4 mt-0.5 rounded-full bg-[#2D323B]/10 text-[#2D323B] text-[10px] font-black flex items-center justify-center shrink-0">
        <Check size={11} />
      </span>
      {children}
    </li>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-8 h-8 rounded-xl bg-[#2D323B] text-white flex items-center justify-center shrink-0">{icon}</span>
        <h2 className="text-[14px] font-black text-gray-800 leading-snug">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function RakutenGuidePage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA]">
      <header className="bg-[#2D323B] px-3 py-2.5 shadow-sm sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <Link href="/guide" aria-label="はじめてガイドに戻る" className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <span className="text-white font-black text-[15px]">楽天で仕入れる</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        {/* イントロ */}
        <div className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <ShoppingBag size={18} className="text-[#2D323B]" />
            <h2 className="text-[14px] font-black text-gray-800">楽天 ＝ このサイトの「仕入れ先」</h2>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            輸出ラボでは、<b>楽天市場</b>で日本の人気商品を仕入れて、eBayで海外に売ります。楽天は日本最大級の通販モールで、
            ふだんのネット通販と同じ感覚で買えるのに、<b>買うたびにポイントが貯まる</b>のが大きな特長です。
          </p>
        </div>

        {/* なぜ楽天 */}
        <Card icon={<Coins size={16} />} title="なぜ楽天で仕入れるの？">
          <p className="text-[13px] text-gray-600 leading-relaxed mb-2">
            ポイント還元のぶん、<b>実質の仕入れコストが下がる</b>からです。たとえば1万円の商品でポイントが2,000pt返ってくれば、
            実質コストは8,000円。<b>その差がそのまま利益に上乗せ</b>されます。
          </p>
          <div className="bg-[#F5F7FA] rounded-xl p-3 text-[12px] text-gray-600 font-mono space-y-1">
            <div className="flex justify-between"><span>商品価格</span><span className="text-[#2D323B]">10,000円</span></div>
            <div className="flex justify-between"><span>ポイント還元</span><span className="text-[#5A6472]">− 2,000pt</span></div>
            <div className="flex justify-between font-black text-emerald-600 pt-1 border-t border-[#A98B5C]/35"><span>実質コスト</span><span>＝ 8,000円</span></div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">※ ポイントは1pt＝1円として、次の仕入れにそのまま使えます。</p>
        </Card>

        {/* ポイント最大化 */}
        <Card icon={<Sparkles size={16} />} title="ポイントを最大化する3つのコツ">
          <ul className="space-y-2">
            <Tip><b>0と5のつく日</b>を狙う：エントリーで楽天カード払いのポイントが<b>最大5倍</b>になります。</Tip>
            <Tip><b>楽天スーパーSALE / お買い物マラソン</b>：複数店舗で買うほど倍率UP。年数回、<b>最大44倍</b>のチャンス。</Tip>
            <Tip><b>SPU（スーパーポイントアッププログラム）</b>：楽天の対象サービスを使うほど、毎回の倍率がベースから底上げされます。</Tip>
          </ul>
          <div className="mt-3 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <Calendar size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[12px] text-blue-800 leading-relaxed">
              急がない仕入れは、<b>還元率の高い日にまとめて買う</b>のがコツ。同じ商品でも、買う日でポイントが大きく変わります。
            </p>
          </div>
        </Card>

        {/* 仕入れの手順 */}
        <Card icon={<ShoppingBag size={16} />} title="仕入れの手順（3ステップ）">
          <ol className="space-y-3">
            {[
              ["輸出ラボで利益商品を見る", "「利益が出そうな商品」を一覧で確認します。利益・利益率・ポイントまで計算済みです。"],
              ["楽天で買う（高還元日を狙う）", "商品カードの「楽天で仕入れる」から楽天へ。0と5のつく日やスーパーSALEだと、さらにお得です。"],
              ["ポイントは次の仕入れへ", "貯まったポイントは1pt＝1円で次の仕入れに使えます。回すほど実質コストが下がります。"],
            ].map(([t, d], i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[#2D323B] text-white text-[12px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                <div>
                  <p className="text-[13px] font-bold text-gray-800">{t}</p>
                  <p className="text-[12px] text-gray-500 leading-relaxed mt-0.5">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        {/* 注意 */}
        <div className="flex items-start gap-2 bg-[#2D323B]/[0.05] border border-[#2D323B]/20 rounded-xl px-3 py-2.5">
          <AlertTriangle size={16} className="text-[#2D323B] shrink-0 mt-0.5" />
          <p className="text-[12px] text-[#2D323B] leading-relaxed">
            <b>仕入れ前に確認：</b>モバイルバッテリー・香水・スプレー・電池内蔵品などは<b>国際郵便で送れない</b>ことがあります。
            「売れたのに送れない」を防ぐため、<b>送れる商品かどうかを仕入れ前にチェック</b>しましょう。価格・在庫・ポイント倍率は変動します。
          </p>
        </div>

        {/* CTA */}
        <div className="text-center pt-2 pb-6">
          <Link href="/search"
            className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:scale-[0.99] text-white font-black px-8 py-3 text-sm rounded-full shadow-md transition-all">
            利益商品を探す →
          </Link>
          <div className="mt-3">
            <Link href="/guide" className="text-[12px] font-bold text-[#0064D2] underline underline-offset-2">
              全体の流れ（はじめてガイド）を見る →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
