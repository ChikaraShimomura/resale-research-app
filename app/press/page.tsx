import type { Metadata } from "next";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import CopyText from "../components/CopyText";

export const metadata: Metadata = {
  title: "プレスキット｜輸出ラボ（紹介・メディア向け）",
  description:
    "輸出ラボ（日本の中古→eBay輸出の利益リサーチツール）の紹介・メディア向けプレスキット。サービス概要・特長・コピペで使える紹介文・ブランド情報をまとめています。",
  alternates: { canonical: "/press" },
  robots: { index: false }, // 紹介者向けの実務ページ（検索意図と無関係なのでnoindex）
};

const SHORT_INTRO =
  "輸出ラボは、eBayで売れている型番を日本の中古サイト（ハードオフ等）の現在価格と照合し、純利益で「儲かる中古」を探せるリサーチツール。eBay手数料・国際送料・米国関税まで引いた“手取りベースの純利益率”を状態ランクつきで自動表示。30日無料、その後 月¥5,000〜（要会員登録）。（利益は想定・目安）";

const LONG_INTRO = `「輸出ラボ」は、日本の中古を仕入れてeBayへ輸出・転売する副業向けのリサーチツール。

eBayで売れている型番を、日本の中古サイト（ハードオフ等）の現在価格と照合。eBay手数料（落札手数料＋海外決済手数料＋為替で約17%＋固定・時計等は約18%）・国際送料・米国関税まで引いた“手取りベースの純利益率”を自動計算し、状態ランクつきで「いま仕入れて利益が出る中古」を一覧できます。ジャンル別・利益順に絞り込んで探せます。

英語・貿易の知識がない初心者でも始めやすいのが特長。航空危険物など国際郵便で送れない商品は除外、数字はすべて「想定・目安」で表示（収入の断定なし）。

要会員登録。まずは30日無料、その後 月¥5,000〜。
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
            <span className="whitespace-nowrap">紹介・レビュー・メディア掲載用の素材。</span><wbr />
            <span className="whitespace-nowrap">下の紹介文はそのまま</span><wbr />
            <span className="whitespace-nowrap">コピーして使えます。</span>
          </p>
        </div>

        <Card title="サービス概要">
          <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
            <li>
              <span className="whitespace-nowrap">・<b>一言</b>：</span><wbr />
              <span className="whitespace-nowrap">eBayで売れる型番を</span><wbr />
              <span className="whitespace-nowrap">日本の中古サイト価格と照合し</span><wbr />
              <span className="whitespace-nowrap">「儲かる中古」を探す</span><wbr />
              <span className="whitespace-nowrap">リサーチツール</span>
            </li>
            <li>・<b>誰向け</b>：eBay輸出の初心者〜中級／中古せどり層</li>
            <li>・<b>料金</b>：30日無料 → その後 月¥5,000〜（要会員登録）</li>
            <li>・<b>URL</b>：<a href="https://www.yushutsu-fukugyo.com" className="text-[#2D323B] underline underline-offset-2">yushutsu-fukugyo.com</a></li>
          </ul>
        </Card>

        <Card title="特長">
          <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
            <li>
              <span className="whitespace-nowrap">・中古仕入れ値→eBay想定売値→</span><wbr />
              <b className="whitespace-nowrap">手取り（純利益）ベースの利益率</b><wbr />
              <span className="whitespace-nowrap">（eBay手数料・国際送料・米国関税を反映）</span><wbr />
              <span className="whitespace-nowrap">を状態ランクつきで自動表示</span>
            </li>
            <li>・<b>毎日更新の利益カタログ</b>／儲かる中古の型番DB（ジャンル別・利益順）</li>
            <li>・<b>画像つき始め方ガイド</b>（英語・貿易知識ほぼ不要）</li>
            <li>
              <span className="whitespace-nowrap">・航空危険物など</span><wbr />
              <span className="whitespace-nowrap">国際郵便で送れない商品は</span>
              <b className="whitespace-nowrap">除外</b>
              <span className="whitespace-nowrap">／数字は</span>
              <b className="whitespace-nowrap">すべて想定・目安</b><wbr />
              <span className="whitespace-nowrap">（収入の断定なし）</span>
            </li>
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
            <li>・<b>メインカラー</b>：チャコール <span className="inline-block align-middle w-3 h-3 rounded-sm bg-[#2D323B] mx-1" /> #2D323B</li>
            <li>・<b>運営</b>：個人開発（日本の中古→eBay輸出を自身でも実践）</li>
            <li>・<b>位置づけ</b>：eBay・各仕入れ元サイトとは独立した非公式サービス</li>
          </ul>
        </Card>

        <p className="text-[11px] text-gray-400 leading-relaxed px-1">
          <span className="whitespace-nowrap">※ 紹介時は</span><wbr />
          <span className="whitespace-nowrap">利益・収入を断定する表現</span><wbr />
          <span className="whitespace-nowrap">（「必ず」「誰でも◯円」等）はお控えを。</span><wbr />
          <span className="whitespace-nowrap">利益はすべて想定・目安です。</span><wbr />
          <span className="whitespace-nowrap">PR・タイアップ時は</span><wbr />
          <span className="whitespace-nowrap">「PR／広告」表記を。</span>
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
