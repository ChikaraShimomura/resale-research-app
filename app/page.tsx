import Link from "next/link";
import { Target, Languages, MapPin, TrendingUp, ShieldCheck } from "lucide-react";
import AuthButton from "./components/AuthButton";
import BottomNav from "./components/BottomNav";
import GuideVideo from "./components/GuideVideo";
import TrackView from "./components/TrackView";
import TrustBadges from "./components/TrustBadges";
import { META_DESC } from "./lib/marketing";
import { PAYWALL_ENABLED } from "./lib/plans";

export const metadata = {
  description: META_DESC,
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  // 有料化後は「登録すれば見える」は誤り（購読が要る）。未購読の主要CTAは /pricing（30日無料）へ誘導。
  const ctaHref = PAYWALL_ENABLED ? "/pricing" : "/search";
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <TrackView event="visit" />

      {/* ヘッダー */}
      <header className="bg-[#2D323B] px-4 py-3 shadow-sm sticky top-0 z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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
            <Target size={13} /> 楽天ポイント × eBay輸出
          </p>
          <h1 className="text-2xl font-black mb-3 leading-snug">
            楽天で買って<br />
            <span className="text-yellow-300">ポイントを稼ぎながら</span><br />
            eBayで売る
          </h1>
          <p className="text-white/80 text-sm leading-relaxed">
            仕入れ価格＋ポイント還元で利益を最大化。<br />日本にしかない商品を海外で高く売る。
          </p>
        </div>
      </div>

      {/* ホーム紹介動画＝ファーストビュー直下。画面内でミュート自動再生＋「音声をオン」（焼き込み字幕で内容は伝わる） */}
      <section className="max-w-2xl mx-auto px-4 pt-6">
        <GuideVideo
          title="在庫ゼロで始めるeBay輸出（約2分）"
          src="/videos/home-intro.mp4"
          poster="/videos/home-intro-poster.jpg"
          durationLabel="約2分"
          autoplayInView
          note="※ 相場・利益率は想定／目安で、利益を保証するものではありません。eBay等の各種ポリシーは公式をご確認のうえご利用ください。／ 音声 VOICEVOX:ずんだもん"
        />
        <div className="mt-3 text-center">
          <Link href="/guide" className="text-[12px] font-bold text-[#2D323B] underline underline-offset-2">
            eBay登録・出金の動画も見る →
          </Link>
        </div>
      </section>

      {/* 「海外に売るのは怖い／難しい」を払拭する安心セクション（先頭＝まず不安を解く） */}
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
              <div className="w-9 h-9 rounded-full bg-[#A98B5C]/10 ring-1 ring-[#A98B5C]/30 flex items-center justify-center mb-2.5">
                <Icon size={17} strokeWidth={1.75} className="text-[#2D323B]" />
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

      {/* このサイトで使う3つのサービス（仕入れ→販売→受け取り・信頼ブロック／押すと各ガイドへ） */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-2">
        <TrustBadges withRakuten linked />
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-10 text-center">
        <Link href={ctaHref}
          className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:bg-[#1A1D23] text-white font-black px-8 py-3.5 text-sm transition-all shadow-md rounded-xl">
          {PAYWALL_ENABLED ? "30日無料ではじめる →" : "登録して利益商品を探す →"}
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
          ※ 利益（現金）はeBayの想定売値（現在の出品ベース）からeBay手数料(13.25%)・国内送料・米国関税($100超)を差し引いて計算しています（国際送料は購入者負担）。楽天ポイントは利益に含めず別表示（おまけ）。<br />
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
