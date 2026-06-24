import type { Metadata } from "next";
import Link from "next/link";
import { getTopProfitProducts } from "../lib/topProducts";
import { canViewCatalog } from "../lib/auth/plan";
import BottomNav from "../components/BottomNav";
import JsonLd from "../components/JsonLd";
import { Flame, ArrowRight, Lock } from "lucide-react";

export const dynamic = "force-dynamic"; // KVの最新在庫＋出品者数で毎回ランキング

const SITE = "https://www.yushutsu-fukugyo.com";
const TITLE = "eBay輸出の利益商品ランキング【毎日更新】｜想定売値・利益率";
const DESC =
  "eBay輸出でいま利益率が高い日本の商品をランキングで毎日更新。カメラ・フィギュア・レトロゲーム・腕時計・炊飯器など、海外で売れる商品の想定売値・利益率の目安をチェック（ランキングは無料公開・各商品の詳細はプランで解放）。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/ranking" },
  // 独自 openGraph を持つページは親(layout)のOG画像を継承せず置き換える＝og:image が消える。
  // そのため共通カード画像(/opengraph-image・middlewareで公開許可済み)を明示参照して付与する。
  openGraph: {
    title: TITLE,
    description: DESC,
    type: "website",
    url: `${SITE}/ranking`,
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/twitter-image"] },
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const items = await getTopProfitProducts(30);
  // 詳細(/product/*)を見られるか＝未購読(free)はゲートで/pricingに飛ぶ。CTA文言を「この先は有料」と事前提示するために使う。
  const canView = await canViewCatalog();
  // /pricing から戻ってきた時の出口メッセージ用（回遊維持：ランキング自体は無料で見られることを伝える）。
  const sp = await searchParams;
  const cameFromPricing = sp.from === "pricing";

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "eBay輸出の利益商品ランキング",
    description: DESC,
    numberOfItems: items.length,
    // 商品詳細(/product/*)は購読ゲートでクローラが/registerへ飛ぶため、ListItemにgated URLを載せない（name+positionのみ）。
    itemListElement: items.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.title.slice(0, 90),
    })),
  };

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <JsonLd data={itemListLd} />

      <header className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
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
        {/* /pricing から戻った人向けの出口メッセージ：ランキングは無料で見られる＝回遊を維持する（未購読のみ）。 */}
        {cameFromPricing && !canView && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#A98B5C]/40 bg-[#2D323B]/[0.04] px-3.5 py-2.5"
            role="status">
            <span className="mt-0.5 shrink-0 text-[#2D323B]" aria-hidden="true"><Flame size={16} /></span>
            <p className="text-[12px] leading-relaxed text-gray-700">
              <b className="text-[#2D323B]">ランキングは無料で見られます。</b>
              各商品の詳細（仕入れ先・想定売値・利益の内訳）と自動出品は、プランで解放されます。
            </p>
          </div>
        )}

        <h1 className="text-xl font-black text-gray-900 leading-snug mb-2">
          eBay輸出の利益商品ランキング
        </h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
          国内で仕入れ<b>eBay（海外）</b>で売って、いま<b>利益率が高い日本商品</b>を毎日更新。
          <b>仕入れ値 → eBay想定売値（直近の落札ベース）→ 利益率</b>の目安付き（ランキング無料・各商品の詳細はプランで解放）。
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
          ※ 定番ジャンル＝カメラ・フィギュア／アニメグッズ・レトロゲーム・腕時計・炊飯器など。利益率・相場はeBayの<b>直近落札（実売値）ベース</b>の目安で、状態・競合・為替で変動。
        </p>

        {items.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-gray-700 mb-1">集計中</p>
            <p className="text-[12px] text-gray-500 mb-4">商品は随時入れ替わります。少し時間をおいて再度どうぞ。</p>
            <Link href={canView ? "/search" : "/pricing?from=ranking"}
              className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
              {canView ? (
                <>利益商品をさがす <ArrowRight size={16} /></>
              ) : (
                <><Lock size={15} className="text-[#A98B5C]" aria-hidden="true" /> プランで全部見る</>
              )}
            </Link>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {items.map((p, i) => {
              // Top5はモザイク（登録誘導の“ちら見せ”）。6位以降は見せて「実在する」証明にする。
              // 購読者(canView)は詳細を見られるのでモザイクにせず通常表示＝壁の体験を購読状態に合わせる。
              const locked = i < 5 && !canView;
              // 詳細はゲート対象。未購読は/pricing（戻り先が分かるようfrom=ranking付き）、購読者は商品詳細へ。
              const href = canView
                ? `/product/${encodeURIComponent(p.id)}`
                : "/pricing?from=ranking";
              return (
                <li key={p.id}>
                  <Link href={href}
                    aria-label={locked ? `${i + 1}位の利益商品（詳細はプランで解放）` : undefined}
                    className="relative flex items-center gap-3 bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm active:bg-gray-50 overflow-hidden">
                    <span className={`w-7 shrink-0 text-center font-black ${i < 3 ? "text-[#2D323B] text-lg" : "text-gray-400 text-sm"}`}>
                      {i + 1}
                    </span>
                    <div className={`flex items-center gap-3 flex-1 min-w-0 ${locked ? "blur-[5px] select-none" : ""}`} aria-hidden={locked || undefined}>
                      {p.imageUrl && !locked ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0" />
                      ) : (
                        // ロック(Top5)は実画像URLもHTMLに出さない（漏洩対策）。
                        <div className="w-14 h-14 rounded-lg bg-gray-100 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{locked ? "商品名はプランで解放" : p.title}</p>
                        <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                          {/* ロック(Top5)は実値をHTMLに出さない＝CSSぼかしだけだとソース/curlで漏れるため(漏洩対策)。 */}
                          {locked ? (
                            <>仕入れ <span className="text-gray-400">●●●</span> <span className="text-gray-300">→</span> eBay想定 <span className="text-gray-400">●●●</span></>
                          ) : (
                            <>仕入れ {yen(p.source?.price)} <span className="text-gray-300">→</span> eBay想定 <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span></>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm">
                          <Flame size={13} />{locked ? "●●" : `${p.realProfitRate}%`}
                        </span>
                        <p className="text-[9px] text-gray-400">利益率</p>
                      </div>
                    </div>
                    {locked && (
                      <span className="absolute inset-0 flex items-center justify-center bg-white/20">
                        <span className="inline-flex items-center gap-1.5 bg-[#2D323B]/95 text-white text-[11px] font-bold px-3.5 py-1.5 rounded-full shadow-lg ring-1 ring-[#A98B5C]/60">
                          <Lock size={12} className="text-[#A98B5C]" aria-hidden="true" /> プランで全部見る
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}

        {/* 内部リンク（回遊＆SEO）。検索/詳細はゲート対象＝未購読には「この先は有料」と事前提示する。ガイドは無料公開なので通常表示。 */}
        <div className="mt-6 grid grid-cols-1 gap-2">
          {canView ? (
            <Link href="/search" className="flex items-center justify-center gap-1.5 h-12 bg-[#2D323B] text-white font-black text-sm rounded-xl active:bg-[#1A1D23]">
              すべての利益商品をさがす <ArrowRight size={16} />
            </Link>
          ) : (
            <div>
              <Link href="/pricing?from=ranking"
                className="flex items-center justify-center gap-1.5 h-12 bg-[#2D323B] text-white font-black text-sm rounded-xl active:bg-[#1A1D23] ring-1 ring-[#A98B5C]/50">
                <Lock size={16} className="text-[#A98B5C]" aria-hidden="true" /> プランで全部見る
              </Link>
              <p className="mt-1.5 text-center text-[11px] text-gray-400 leading-relaxed">
                ランキングは無料。<b className="text-gray-500">各商品の詳細・検索・自動出品はプラン（月¥500〜・30日無料）で解放</b>されます。
              </p>
            </div>
          )}
          <Link href="/guide" className="flex items-center justify-center gap-1.5 h-11 bg-white border border-[#A98B5C]/35 text-gray-700 font-bold text-[13px] rounded-xl active:bg-gray-50">
            eBay輸出の始め方ガイド（無料）
          </Link>
        </div>

        <p className="mt-6 text-[11px] text-gray-400 leading-relaxed">
          輸出ラボは国内仕入れ→eBay輸出の副業向け<b>リサーチ＆出品ツール</b>（ランキング無料・本格利用は月¥500〜）。利益（現金）は仕入れ値・eBay手数料(13.25%)・国内送料・米国関税で算出した想定値。国際送料は購入者負担のため非算入、ポイントは利益に含めず別枠（おまけ）扱い。
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
