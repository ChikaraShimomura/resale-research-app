import type { Metadata } from "next";
import Link from "next/link";
import { getUsedCatalog, getHiddenCatalogKeys, catalogItemKey, isProhibited } from "../lib/usedCatalog";
import { canViewCatalog } from "../lib/auth/plan";
import { getActorId } from "../lib/auth/actor";
import BottomNav from "../components/BottomNav";
import JsonLd from "../components/JsonLd";
import { Flame, ArrowRight, Lock } from "lucide-react";

export const dynamic = "force-dynamic"; // KVの最新在庫＋出品者数で毎回ランキング

const SITE = "https://www.yushutsu-fukugyo.com";
const TITLE = "eBay輸出の利益商品ランキング【毎日更新】｜想定売値・利益率";
const DESC =
  "いま仕入れて利益が見込める中古品を、想定利益つきの毎日更新ランキングで。eBay輸出の副業に（無料公開・各商品の仕入れ先はプランで解放）。";

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
  // 仕入れ先(ハードオフ/2nd STREET)リンクを見られるか＝未購読(free)はゲートで/pricingに飛ぶ。
  const canView = await canViewCatalog();
  // ログイン中なら本人が「仕入れた/これは無理」で外した品はランキングからも差し引く（カタログと整合）。
  const hidden = await getHiddenCatalogKeys(await getActorId());
  // カタログと同じ品質バー：同一型番でeBay相場確定済み(ebayConfirmed)＋ジャンク除外のみを公開ランキングに出す
  //（未確定の「系列の目安」やジャンクの不確かな利益を公開面に出さない）。
  const items = (await getUsedCatalog())
    .filter((p) => p.ebayConfirmed && p.profitRate >= 5 && !hidden.has(catalogItemKey(p)) && !isProhibited(`${p.brand} ${p.name}`))
    .slice(0, 30); // 中古の利益カタログ（純利益順）の上位（利益率5%未満/発送不可は除外・ジャンクは掲載）
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
      name: `${p.brand} ${p.name}`.slice(0, 90),
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
              <b className="text-[#2D323B]">ランキングは無料で見られます。</b><wbr />
              <span className="whitespace-nowrap">各商品の詳細</span><wbr />
              <span className="whitespace-nowrap">（仕入れ先・想定売値・利益の内訳）は、</span><wbr />
              <span className="whitespace-nowrap">プランで解放されます。</span>
            </p>
          </div>
        )}

        <h1 className="text-xl font-black text-gray-900 leading-snug mb-2">
          eBay輸出で儲かる中古 ランキング
        </h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
          <span className="whitespace-nowrap">日本の<b>中古</b>を仕入れ</span><wbr />
          <span className="whitespace-nowrap"><b>eBay（海外）</b>で売って、</span><wbr />
          <span className="whitespace-nowrap">いま<b>純利益が出る型番</b>を毎日更新。</span><wbr />
          <span className="whitespace-nowrap"><b>仕入れ値</b></span><wbr />
          <span className="whitespace-nowrap">→ <b>eBay想定売値</b></span><wbr />
          <span className="whitespace-nowrap"><b>（直近の落札ベース）</b></span><wbr />
          <span className="whitespace-nowrap">→ <b>純利益</b>の目安付き</span><wbr />
          <span className="whitespace-nowrap">（ランキング無料・仕入れ先はプランで解放）。</span>
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
          <span className="whitespace-nowrap">※ 定番ジャンル＝</span><wbr />
          <span className="whitespace-nowrap">カメラ・オーディオ・楽器・</span><wbr />
          <span className="whitespace-nowrap">フィギュア・腕時計など。</span><wbr />
          <span className="whitespace-nowrap">相場はeBayの</span><wbr />
          <span className="whitespace-nowrap"><b>直近落札（実売値）ベース</b>の目安で、</span><wbr />
          <span className="whitespace-nowrap">中古は1点物のため在庫は流動的・</span><wbr />
          <span className="whitespace-nowrap">状態・競合・為替で変動。</span>
        </p>

        {items.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-gray-700 mb-1">集計中</p>
            <p className="text-[12px] text-gray-500 mb-4">
              <span className="whitespace-nowrap">商品は随時入れ替わります。</span><wbr />
              <span className="whitespace-nowrap">少し時間をおいて再度どうぞ。</span>
            </p>
            <Link href={canView ? "/catalog" : "/pricing?from=ranking"}
              className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
              {canView ? (
                <>中古カタログを見る <ArrowRight size={16} /></>
              ) : (
                <><Lock size={15} className="text-[#A98B5C]" aria-hidden="true" /> プランで全部見る</>
              )}
            </Link>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {items.map((p, i) => {
              // Top5はモザイク（登録誘導の“ちら見せ”）。6位以降は見せて「実在する」証明にする。
              // 購読者(canView)は仕入れ先リンクを見られるのでモザイクにしない＝壁の体験を購読状態に合わせる。
              const locked = i < 5 && !canView;
              // 購読者は仕入れ先(ハードオフ/2nd STREET)の実物ページへ、未購読は/pricing（戻り先が分かるようfrom=ranking付き）。
              // ※ hardoffUrl は命名が紛らわしいが値は site に応じた正しい商品URL（2nd STは 2ndstreet.jp）が入る。
              const href = canView ? p.hardoffUrl : "/pricing?from=ranking";
              const ext = canView ? { target: "_blank", rel: "nofollow noopener noreferrer" } : {};
              return (
                <li key={`${p.modelKey}-${i}`}>
                  <a href={href} {...ext}
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
                        <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{locked ? "商品名はプランで解放" : `${p.brand} ${p.name}`}</p>
                        <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                          {/* ロック(Top5)は実値をHTMLに出さない＝CSSぼかしだけだとソース/curlで漏れるため(漏洩対策)。 */}
                          {locked ? (
                            <>仕入れ <span className="text-gray-400">●●●</span> <span className="text-gray-300">→</span> eBay想定 <span className="text-gray-400">●●●</span></>
                          ) : (
                            <>仕入れ {yen(p.buyJpy)} <span className="text-gray-300">→</span> eBay想定 <span className="text-[#0064D2] font-bold">{yen(p.ebayMedianJpy)}</span></>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm">
                          <Flame size={13} />{locked ? "●●" : `${p.profitRate}%`}
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
                  </a>
                </li>
              );
            })}
          </ol>
        )}

        {/* 内部リンク（回遊＆SEO）。検索/詳細はゲート対象＝未購読には「この先は有料」と事前提示する。ガイドは無料公開なので通常表示。 */}
        <div className="mt-6 grid grid-cols-1 gap-2">
          {canView ? (
            <Link href="/catalog" className="flex items-center justify-center gap-1.5 h-12 bg-[#2D323B] text-white font-black text-sm rounded-xl active:bg-[#1A1D23]">
              中古カタログを全部見る <ArrowRight size={16} />
            </Link>
          ) : (
            <div>
              <Link href="/pricing?from=ranking"
                className="flex items-center justify-center gap-1.5 h-12 bg-[#2D323B] text-white font-black text-sm rounded-xl active:bg-[#1A1D23] ring-1 ring-[#A98B5C]/50">
                <Lock size={16} className="text-[#A98B5C]" aria-hidden="true" /> プランで全部見る
              </Link>
              <p className="mt-1.5 text-center text-[11px] text-gray-400 leading-relaxed">
                <span className="whitespace-nowrap">ランキングは無料。</span><wbr />
                <span className="whitespace-nowrap"><b className="text-gray-500">各商品の詳細・仕入れ先は</b></span><wbr />
                <span className="whitespace-nowrap"><b className="text-gray-500">プラン（月¥1,000〜・30日無料）で解放</b>されます。</span>
              </p>
            </div>
          )}
          <Link href="/guide" className="flex items-center justify-center gap-1.5 h-11 bg-white border border-[#A98B5C]/35 text-gray-700 font-bold text-[13px] rounded-xl active:bg-gray-50">
            eBay輸出の始め方ガイド（無料）
          </Link>
        </div>

        <p className="mt-6 text-[11px] text-gray-400 leading-relaxed">
          <span className="whitespace-nowrap">輸出ラボは国内の中古→eBay輸出の</span><wbr />
          <span className="whitespace-nowrap">副業向け<b>リサーチツール</b></span><wbr />
          <span className="whitespace-nowrap">（ランキング無料・本格利用は月¥5,000〜）。</span><wbr />
          <span className="whitespace-nowrap">表示の想定利益は目安で、</span><wbr />
          <span className="whitespace-nowrap">商品の状態・相場・為替で変動します。</span>
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
