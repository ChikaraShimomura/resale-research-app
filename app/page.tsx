import Link from "next/link";
import { Languages, MapPin, TrendingUp, ShieldCheck, Search, Tag, Banknote } from "lucide-react";
import AuthButton from "./components/AuthButton";
import BottomNav from "./components/BottomNav";
import HomeHub from "./components/HomeHub";
import TrackView from "./components/TrackView";
import TrustBadges from "./components/TrustBadges";
import { META_DESC } from "./lib/marketing";
import { PAYWALL_ENABLED } from "./lib/plans";
import { getCurrentUserEmail } from "./lib/auth/plan";

export const metadata = {
  description: META_DESC,
  alternates: { canonical: "/" },
};

// ホーム＝ / は1つだが中身は2面：
//  未ログイン → 従来の集客LP（LandingPage・構造は不変）。
//  ログイン   → 自分の状況＝パーソナルハブ（HomeHub）。集客文言は出さない。
// 分岐はサーバー側のログイン判定(getCurrentUserEmail)で吸収。BottomNavのホームは / のままでよい。
export default async function Home() {
  const email = await getCurrentUserEmail();
  if (email) return <HubPage />;
  return <LandingPage />;
}

// ログイン時のホーム。ヘッダー／フッターのトーンはLPと揃え、本文だけ HomeHub に差し替える。
function HubPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <TrackView event="visit" />

      {/* ヘッダー（LPと同一トーン） */}
      <header className="bg-[#2D323B] px-4 py-3 shadow-sm sticky top-0 z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm">
              <span className="text-[#2D323B] font-black text-base leading-none">R</span>
            </div>
            <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <AuthButton />
          </div>
        </div>
      </header>

      <HomeHub />

      <BottomNav />
    </div>
  );
}

function LandingPage() {
  // 有料化後は「登録すれば見える」は誤り（購読が要る）。未購読の主要CTAは /pricing（30日無料）へ誘導。
  // 非PAYWALL時は新モデルの入口＝中古の利益カタログ(/catalog)へ。
  const ctaHref = PAYWALL_ENABLED ? "/pricing" : "/catalog";
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

      {/* ヒーロー（コンパクト＝すぐ下に動画） */}
      <div className="bg-gradient-to-br from-[#2D323B] to-[#1A1D23] text-white">
        <div className="max-w-2xl mx-auto px-6 py-5 text-center">
          <h1 className="text-xl font-black leading-snug">
            <span className="text-[#D8C089]">eBay輸出</span>で、儲かる中古を見つける
          </h1>
          <p className="text-white/75 text-[13px] leading-relaxed mt-1.5">
            仕入れて利益が出る中古の型番が、ひと目でわかる。
          </p>
        </div>
      </div>

      {/* はじめての人が“文字で3秒”で仕組みを掴むための3ステップ（動画/ガイドの前に置く＝受け身の動画頼みをやめる） */}
      <section className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">どんなサイト？ 3ステップで</h2>
        </div>
        <ol className="grid grid-cols-3 gap-2">
          {[
            { n: 1, Icon: Search, t: "儲かる型番が見つかる", d: "eBayで売れてる型番を毎日提示" },
            { n: 2, Icon: Tag, t: "純利益で判断", d: "送料・関税・手数料を引いた手取りで表示" },
            { n: 3, Icon: Banknote, t: "中古を仕入れて輸出", d: "状態ランク付き。仕入れ先リンクから" },
          ].map(({ n, Icon, t, d }) => (
            <li key={n} className="flex flex-col items-center text-center bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm">
              <span className="w-8 h-8 rounded-full bg-[#2D323B] text-white font-black text-[13px] flex items-center justify-center mb-1.5">{n}</span>
              <Icon size={16} className="text-[#A98B5C] mb-1" />
              <p className="text-[12px] font-black text-gray-800 leading-tight">{t}</p>
              <p className="text-[10px] text-gray-500 leading-snug mt-1">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 text-center">
          <Link href="/guide" className="inline-flex items-center justify-center gap-1.5 h-11 px-6 rounded-xl bg-[#2D323B] text-white text-[13px] font-black active:bg-[#1A1D23]">
            使い方を詳しく見る →
          </Link>
        </div>
      </section>

      {/* ホーム紹介動画(home-intro.mp4)は旧モデル前提のナレーションのため、中古モデル用に再生成するまで一旦非表示。
          eBay登録・出金の動画(モデル非依存)は /guide に置いてあり、上の「使い方を詳しく見る」から到達できる。 */}

      {/* 「海外に売るのは怖い／難しい」を払拭する安心セクション（先頭＝まず不安を解く） */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1 h-5 bg-gradient-to-b from-[#2D323B] to-[#A98B5C] rounded-full" />
          <h2 className="text-sm font-black text-gray-800">「海外に売るのは難しそう」はもう古い</h2>
        </div>
        <p className="text-[12px] text-gray-500 mb-4 pl-3">日本にいながら、いつもの通販と同じ感覚で。</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { Icon: Languages, t: "英語はいらない", d: <><span className="whitespace-nowrap">出品タイトルは自動作成。</span><wbr /><span className="whitespace-nowrap">やり取りも定型文でOK。</span></> },
            { Icon: MapPin, t: "日本にいながら完結", d: <><span className="whitespace-nowrap">仕入れも発送も国内。</span><wbr /><span className="whitespace-nowrap">海外発送は近くの郵便局・</span><wbr /><span className="whitespace-nowrap">国際郵便マイページから。</span></> },
            { Icon: TrendingUp, t: "海外だから高く売れる", d: <><span className="whitespace-nowrap">日本にしかない商品は、</span><wbr /><span className="whitespace-nowrap">海外で価値が上がり高値に。</span></> },
            { Icon: ShieldCheck, t: "守られて取引できる", d: <><span className="whitespace-nowrap">eBayの取引保護＋</span><wbr /><span className="whitespace-nowrap">追跡付き発送。</span><wbr /><span className="whitespace-nowrap">正直な説明でトラブル回避。</span></> },
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

      {/* このサイトで使うサービス（販売=eBay／受け取り=Payoneer。仕入れは中古サイトなので仕入れ元バッジは出さない） */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-2">
        <TrustBadges linked />
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-4 pt-6 pb-10 text-center">
        <Link href={ctaHref}
          className="inline-block bg-[#2D323B] hover:bg-[#1A1D23] active:bg-[#1A1D23] text-white font-black px-8 py-3.5 text-sm transition-all shadow-md rounded-xl">
          {PAYWALL_ENABLED ? "30日無料ではじめる →" : "中古の利益カタログを見る →"}
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
          <span className="whitespace-nowrap">※ 表示の想定売値・利益は目安です。</span><wbr />
          <span className="whitespace-nowrap">手数料・送料などを差し引いた手取りベースで、</span><wbr />
          <span className="whitespace-nowrap">実際は商品の状態・相場・為替で変動します。</span><wbr />
          <span className="whitespace-nowrap">中古は1点物のため在庫は流動的。</span>
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
        <p className="mt-4 text-[10px] text-gray-400">
          <span className="whitespace-nowrap">輸出ラボは eBay・</span><wbr />
          <span className="whitespace-nowrap">各仕入れ元サイトとは独立した</span><wbr />
          <span className="whitespace-nowrap">非公式サービスです。</span>
        </p>
      </footer>

      <BottomNav />
    </div>
  );
}
