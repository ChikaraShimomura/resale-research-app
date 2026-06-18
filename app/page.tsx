import Link from "next/link";
import { Target, Languages, MapPin, TrendingUp, ShieldCheck, BookOpen } from "lucide-react";
import AuthButton from "./components/AuthButton";
import BottomNav from "./components/BottomNav";
import RakutenPointChips from "./components/RakutenPointChips";
import TrackView from "./components/TrackView";
import TrustBadges from "./components/TrustBadges";

export const metadata = {
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <TrackView event="visit" />

      {/* ヘッダー */}
      <header className="bg-[#2D323B] px-4 py-3 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm">
              <span className="text-[#2D323B] font-black text-base leading-none">R</span>
            </div>
            <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
          </div>
          {/* ガイドはヒーロー内のボタンに集約したのでヘッダーからは外す（ログイン時の混雑も解消） */}
          <div className="flex items-center gap-2 min-w-0">
            <AuthButton />
          </div>
        </div>
      </header>

      {/* ヒーロー */}
      <div className="bg-gradient-to-br from-[#2D323B] via-[#2D323B] to-[#1A1D23] text-white">
        <div className="max-w-2xl mx-auto px-6 py-10 text-center">
          <p className="text-xs font-bold bg-white/20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-4 backdrop-blur-sm">
            <Target size={13} /> 楽天ポイント × eBay転売
          </p>
          <h1 className="text-2xl font-black mb-3 leading-snug">
            楽天で買って<br />
            <span className="text-yellow-300">ポイントを稼ぎながら</span><br />
            eBayで売る
          </h1>
          <p className="text-white/80 text-sm leading-relaxed mb-7">
            仕入れ価格＋ポイント還元で利益を最大化。<br />日本にしかない商品を海外で高く売る。
          </p>
          <Link href="/search"
            className="inline-block bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-gray-900 font-black px-8 py-3.5 rounded-xl text-sm transition-all shadow-lg">
            登録して利益商品を見る →
          </Link>
          <div className="mt-3">
            <Link href="/guide"
              className="inline-flex items-center gap-1.5 text-white/90 text-sm font-bold border border-white/40 px-5 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm active:bg-white/20">
              <BookOpen size={15} /> はじめての方へ・使い方ガイド
            </Link>
          </div>
        </div>
      </div>

      {/* このサイトで使う3つのサービス（仕入れ→販売→受け取り・信頼ブロック／押すと各ガイドへ） */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-2">
        <TrustBadges withRakuten linked />
      </section>

      {/* 仕組み説明 */}
      <div className="bg-white border-b border-[#A98B5C]/25 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex items-start justify-center gap-4">
            {[
              { step: "①", text: "楽天で仕入れ", sub: "ポイント最大20%還元", color: "bg-[#BF0000]" },
              { arrow: true },
              { step: "②", text: "eBayで出品", sub: "海外需要で高値売却", color: "bg-[#0064D2]" },
              { arrow: true },
              { step: "③", text: "利益＋ポイント", sub: "二重取りで稼ぐ", color: "bg-emerald-600" },
            ].map((item, i) =>
              "arrow" in item ? (
                <span key={i} aria-hidden="true" className="text-gray-300 text-xl shrink-0 mt-2">›</span>
              ) : (
                <div key={i} className="flex flex-col items-center shrink-0">
                  <div aria-hidden="true" className={`w-10 h-10 ${item.color} text-white rounded-full flex items-center justify-center text-sm font-black shadow-sm`}>
                    {item.step}
                  </div>
                  <p className="text-xs font-bold text-gray-700 mt-2 text-center whitespace-nowrap">{item.text}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 text-center whitespace-nowrap">{item.sub}</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>


      {/* 「海外に売るのは怖い／難しい」を払拭する安心セクション */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">「海外に売るのは難しそう」は、もう古い</h2>
        </div>
        <p className="text-[12px] text-gray-500 mb-4 pl-3">日本にいながら、いつもの通販と同じ感覚で始められます。</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { Icon: Languages, t: "英語はいらない", d: "出品タイトルは自動で作成。購入者とのやり取りも定型文でこなせます。" },
            { Icon: MapPin, t: "日本にいながら完結", d: "仕入れも発送も国内。海外発送は近くの郵便局・国際郵便マイページから。" },
            { Icon: TrendingUp, t: "海外だから高く売れる", d: "日本にしかない商品は、海外では価値が上がって高値で売れます。" },
            { Icon: ShieldCheck, t: "守られて取引できる", d: "eBayの取引保護＋追跡付き発送。正直な説明でトラブルを防げます。" },
          ].map(({ Icon, t, d }, i) => (
            <div key={i} className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3.5 shadow-sm">
              <div className="w-8 h-8 rounded-full bg-[#2D323B]/10 flex items-center justify-center mb-2">
                <Icon size={16} className="text-[#2D323B]" />
              </div>
              <p className="text-[13px] font-black text-gray-800 mb-1">{t}</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center">
          <Link href="/guide" className="text-[12px] font-bold text-[#2D323B] underline underline-offset-2">
            はじめ方を画像つきガイドで見る →
          </Link>
        </div>
      </section>

      {/* 仕入れ前の楽天SPU準備（ポイント還元を底上げ・小さく横並び） */}
      <section className="max-w-2xl mx-auto px-4 pt-4">
        <RakutenPointChips />
      </section>

      {/* 利益計算の説明 */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">利益の計算方法</h2>
        </div>
        <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
          <div className="flex justify-end mb-2">
            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">例</span>
          </div>
          <div className="bg-[#F5F7FA] rounded-xl p-4 text-xs text-gray-600 space-y-2 font-mono mb-3">
            <div className="flex justify-between"><span>eBayの想定売値</span><span className="text-[#0064D2]">+ ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>楽天仕入れ価格</span><span className="text-[#2D323B]">- ¥XX,XXX</span></div>
            <div className="flex justify-between"><span>国内送料（送料別は概算）</span><span className="text-[#2D323B]">- ¥XXX</span></div>
            <div className="flex justify-between"><span>楽天ポイント還元</span><span className="text-[#FF4466]">+ XXXpt</span></div>
            <div className="flex justify-between"><span>eBay手数料（13.25%+¥47）</span><span className="text-[#2D323B]">- ¥XXX</span></div>
            <div className="flex justify-between"><span>国際送料</span><span className="text-emerald-600 font-bold">購入者負担</span></div>
            <div className="flex justify-between font-black text-emerald-600 pt-2 border-t border-[#A98B5C]/35 text-sm">
              <span>利益</span><span>= ¥X,XXX + XXXpt</span>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-center">全商品の利益計算にはこの計算式を使用しています</p>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-4 pb-10 text-center">
        <Link href="/search"
          className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:bg-[#1A1D23] text-white font-black px-8 py-3.5 text-sm transition-all shadow-md rounded-xl">
          登録して利益商品を探す →
        </Link>
        <div className="mt-4">
          <Link href="/ranking" className="text-[13px] font-bold text-[#2D323B] underline underline-offset-2">
            🔥 いま稼げる利益商品ランキングを見る →
          </Link>
        </div>
        <p className="mt-3 text-sm text-gray-400">たくさんの利益商品を掲載中</p>
      </section>

      {/* フッター */}
      <footer className="bg-white border-t border-[#A98B5C]/25 px-6 py-8 text-center">
        <p className="text-xs leading-relaxed text-gray-400">
          ※ 利益はeBayの想定売値（現在の出品ベース）・楽天ポイント・eBay手数料(13.25%)・国内送料（送料別の商品は概算で原価に算入）をもとに計算しています（国際送料は購入者負担のため利益に含めません）。<br />
          実際の利益は状態・競合・為替等により異なります。
        </p>
        <div className="mt-5 flex items-center justify-center gap-4 text-xs">
          <Link href="/ranking" className="text-gray-500 hover:text-[#2D323B]">ランキング</Link>
          <span aria-hidden="true" className="text-gray-300">·</span>
          <Link href="/guide" className="text-gray-500 hover:text-[#2D323B]">ガイド</Link>
          <span aria-hidden="true" className="text-gray-300">·</span>
          <Link href="/press" className="text-gray-500 hover:text-[#2D323B]">プレスキット</Link>
          <span aria-hidden="true" className="text-gray-300">·</span>
          <Link href="/privacy" className="text-gray-500 hover:text-[#2D323B]">プライバシーポリシー</Link>
        </div>
        <p className="mt-4 text-[10px] text-gray-400">輸出ラボは eBay・楽天とは独立した非公式サービスです。</p>
      </footer>

      <BottomNav />
    </div>
  );
}
