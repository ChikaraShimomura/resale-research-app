import type { Metadata } from "next";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import CopyText from "../components/CopyText";

export const metadata: Metadata = {
  title: "プレスキット｜輸出ラボ（紹介・メディア向け）",
  description:
    "輸出ラボ（楽天→eBay輸出のリサーチ＆出品支援ツール）の紹介・メディア向けプレスキット。サービス概要・特長・コピペで使える紹介文・ブランド情報をまとめています。",
  alternates: { canonical: "/press" },
  robots: { index: false }, // 紹介者向けの実務ページ（検索意図と無関係なのでnoindex）
};

const SHORT_INTRO =
  "輸出ラボは、楽天で仕入れてeBayで売る「利益が出やすい商品」を探せるリサーチ＆出品支援ツール。楽天の仕入れ値からeBay手数料・国内送料・楽天ポイントまで引いた“手取りベースの想定利益率”を自動表示。30日無料、その後 月¥500〜（要会員登録）。（利益は想定・目安）";

const LONG_INTRO = `「輸出ラボ」は、楽天で仕入れてeBayへ輸出・転売する副業向けのリサーチ＆出品支援ツール。

楽天の仕入れ値をもとに、eBayの想定売値（現行の最安〜中央値ベース）と、eBay手数料（13.25%＋約47円）・国内送料・楽天ポイントまで反映した“手取りベースの想定利益率”を自動計算。利益商品リストや毎日更新のランキングから、いま利益が出やすい商品を一目で探せます。

写真だけでほぼ自動のeBay出品や画像つき始め方ガイドもあり、英語・貿易の知識がない初心者でも始めやすいのが特長。航空危険物など国際郵便で送れない商品は除外、数字はすべて「想定・目安」で表示（収入の断定なし）。

要会員登録。まずは30日無料、その後 月¥500〜。
▶ https://www.yushutsu-fukugyo.com`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-4">
      <h2 className="flex items-center gap-2 text-[15px] font-black text-gray-900 mb-2.5">
        <span aria-hidden="true" className="w-1 h-5 bg-[#2D323B] rounded-full shrink-0" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function PressPage() {
  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/" aria-label="トップへ"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">プレスキット</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <div>
          <h1 className="text-xl font-black text-gray-900 leading-snug">輸出ラボ プレスキット</h1>
          <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">
            紹介・レビュー・メディア掲載用の素材。下の紹介文はそのままコピーして使えます。
          </p>
        </div>

        <Card title="サービス概要">
          <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
            <li>・<b>一言</b>：楽天で仕入れてeBayで売る「利益が出やすい商品」を探すリサーチ＆出品支援ツール</li>
            <li>・<b>誰向け</b>：eBay輸出の初心者〜中級／楽天ポイントせどり層</li>
            <li>・<b>料金</b>：30日無料 → その後 月¥500〜（要会員登録）</li>
            <li>・<b>URL</b>：<a href="https://www.yushutsu-fukugyo.com" className="text-[#2D323B] underline underline-offset-2">yushutsu-fukugyo.com</a></li>
          </ul>
        </Card>

        <Card title="特長">
          <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
            <li>・楽天仕入れ値→eBay想定売値→<b>手取り（現金）ベースの想定利益率</b>（手数料・国内送料・米国関税を反映／楽天ポイントは利益に含めず別表示）を自動表示</li>
            <li>・<b>毎日更新の利益商品ランキング</b>／キーワード・条件で検索</li>
            <li>・<b>写真だけでほぼ自動のeBay出品</b>・画像つき始め方ガイド（英語・貿易知識ほぼ不要）</li>
            <li>・航空危険物など国際郵便で送れない商品は<b>除外</b>／数字は<b>すべて想定・目安</b>（収入の断定なし）</li>
          </ul>
        </Card>

        <Card title="紹介文（短）｜コピーして使えます">
          <CopyText text={SHORT_INTRO} />
        </Card>

        <Card title="紹介文（長）｜コピーして使えます">
          <CopyText text={LONG_INTRO} />
        </Card>

        <Card title="ブランド情報">
          <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
            <li>・<b>名称</b>：輸出ラボ</li>
            <li>・<b>メインカラー</b>：クリムゾン <span className="inline-block align-middle w-3 h-3 rounded-sm bg-[#2D323B] mx-1" /> #2D323B</li>
            <li>・<b>運営</b>：個人開発（楽天→eBay輸出を自身でも実践）</li>
            <li>・<b>位置づけ</b>：eBay・楽天とは独立した非公式サービス</li>
          </ul>
        </Card>

        <p className="text-[11px] text-gray-400 leading-relaxed px-1">
          ※ 紹介時は利益・収入を断定する表現（「必ず」「誰でも◯円」等）はお控えを。利益はすべて想定・目安です。PR・タイアップ時は「PR／広告」表記を。
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
