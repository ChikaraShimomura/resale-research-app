import type { Metadata } from "next";
import Link from "next/link";
import { getTopProfitProducts } from "../lib/topProducts";
import BottomNav from "../components/BottomNav";
import JsonLd from "../components/JsonLd";
import { Flame, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic"; // KVの最新在庫＋出品者数で毎回ランキング

const SITE = "https://www.yushutsu-fukugyo.com";
const TITLE = "eBay輸出の利益商品ランキング【毎日更新】｜楽天→eBay相場・利益率";
const DESC =
  "楽天で仕入れてeBayで売る——いま利益率が高い商品をランキングで毎日更新。カメラ・フィギュア・レトロゲーム・腕時計・炊飯器など、海外で売れる日本商品の楽天仕入れ値→eBay想定売値・利益率を無料でチェックできます。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/ranking" },
  openGraph: { title: TITLE, description: DESC, type: "website", url: `${SITE}/ranking` },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

export default async function RankingPage() {
  const items = await getTopProfitProducts(30);

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "eBay輸出の利益商品ランキング",
    description: DESC,
    numberOfItems: items.length,
    itemListElement: items.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/product/${encodeURIComponent(p.id)}`,
      name: p.title.slice(0, 90),
    })),
  };

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <JsonLd data={itemListLd} />

      <header className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/" aria-label="トップへ"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">利益商品ランキング</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <h1 className="text-xl font-black text-gray-900 leading-snug mb-2">
          eBay輸出の利益商品ランキング
        </h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
          楽天で仕入れて<b>eBay（海外）</b>で売ったときに、いま<b>利益率が高い日本商品</b>を毎日更新でランキング。
          各商品の<b>楽天仕入れ値 → eBay想定売値（現在の相場ベース）→ 利益率</b>を、登録なし・無料で確認できます。
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
          ※ 海外で売れやすい定番ジャンル＝カメラ・フィギュア／アニメグッズ・レトロゲーム・腕時計・炊飯器など。利益率・相場は現在の出品ベースの<b>想定（目安）</b>で、状態・競合・為替で変わります。
        </p>

        {items.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-gray-700 mb-1">いま集計中です</p>
            <p className="text-[12px] text-gray-500 mb-4">商品は随時入れ替わります。少し時間をおいて再度ご覧ください。</p>
            <Link href="/search" className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
              利益商品をさがす <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {items.map((p, i) => (
              <li key={p.id}>
                <Link href={`/product/${encodeURIComponent(p.id)}`}
                  className="flex items-center gap-3 bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm active:bg-gray-50">
                  <span className={`w-7 shrink-0 text-center font-black ${i < 3 ? "text-[#2D323B] text-lg" : "text-gray-400 text-sm"}`}>
                    {i + 1}
                  </span>
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-gray-100 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{p.title}</p>
                    <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                      楽天 {yen(p.source?.price)} <span className="text-gray-300">→</span> eBay想定 <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm">
                      <Flame size={13} />{p.realProfitRate}%
                    </span>
                    <p className="text-[9px] text-gray-400">利益率</p>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}

        {/* 内部リンク（回遊＆SEO） */}
        <div className="mt-6 grid grid-cols-1 gap-2">
          <Link href="/search" className="flex items-center justify-center gap-1.5 h-12 bg-[#2D323B] text-white font-black text-sm rounded-xl active:bg-[#1A1D23]">
            すべての利益商品をさがす <ArrowRight size={16} />
          </Link>
          <Link href="/guide" className="flex items-center justify-center gap-1.5 h-11 bg-white border border-[#A98B5C]/35 text-gray-700 font-bold text-[13px] rounded-xl active:bg-gray-50">
            eBay輸出の始め方ガイドを見る
          </Link>
        </div>

        <p className="mt-6 text-[11px] text-gray-400 leading-relaxed">
          輸出ラボは、楽天で仕入れてeBayへ輸出・転売する副業のための<b>無料リサーチツール</b>です。利益は楽天の仕入れ値・楽天ポイント・eBay手数料(13.25%)・国内送料をもとに算出した想定値で、国際送料は購入者負担のため含めていません。
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
