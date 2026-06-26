import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ArrowRight, ExternalLink, ShoppingBag, Lock } from "lucide-react";
import { getBoughtItems, sourceSiteName } from "../lib/usedCatalog";
import { getActorId } from "../lib/auth/actor";
import { canAutoList } from "../lib/auth/plan";
import BottomNav from "../components/BottomNav";
import ListingHelper from "../components/ListingHelper";
import RemoveBoughtButton from "../components/RemoveBoughtButton";
import ShippingInput from "../components/ShippingInput";
import type { ProfitProduct } from "../lib/profitFilter";

export const dynamic = "force-dynamic"; // 自分の仕入れ商品は毎回最新で

export const metadata: Metadata = {
  title: "仕入れた商品｜eBay自動出品",
  robots: { index: false }, // 個人の仕入れ一覧は検索除外
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

export default async function BoughtPage() {
  const actor = await getActorId();
  const items = await getBoughtItems(actor);
  const canList = await canAutoList(); // eBay自動出品はプロMAX限定（＋身内/管理者）

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link
            href="/"
            aria-label="トップへ"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95"
          >
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">仕入れた商品</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <h1 className="text-xl font-black text-gray-900 leading-snug mb-2">仕入れた商品をeBayに出品</h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
          利益カタログで<b>「仕入れた」</b>を押した商品の一覧です。各商品の<b>eBay自動出品</b>から、<b>仕入れ元の写真つき</b>で出品できます。
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
          ※ 写真は仕入れ元（ハードオフ等）の商品画像を自動取得。出品画面で使う写真を選べます。実物が手元にあれば差し替え推奨。
        </p>

        {items.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
            <ShoppingBag size={40} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-bold text-gray-700 mb-1">まだ仕入れた商品はありません</p>
            <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">
              利益カタログで気になる型番を見つけたら<b>「仕入れた」</b>を押すと、ここに入って出品できます。
            </p>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]"
            >
              利益カタログを見る <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {items.map((p, i) => {
              const buyJpy = p.buyJpy ?? p.source?.price ?? 0;
              return (
                <li key={`${p.id}-${i}`}>
                  <div className="relative bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm overflow-hidden">
                    <div className="flex items-start gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="w-16 h-16 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0" />
                      )}

                      <div className="flex-1 min-w-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1">
                          仕入れ済み
                        </span>
                        <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{p.title}</p>
                        <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                          仕入れ {yen(buyJpy)} <span className="text-gray-300">→</span> eBay想定{" "}
                          <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span>
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm">
                          <Flame size={13} />
                          {p.realProfitRate}%
                        </span>
                        <p className="text-[9px] text-gray-400">利益率</p>
                        <p className="text-[11px] font-black text-[#A98B5C] mt-0.5 tabular-nums">+{yen(p.realProfit)}</p>
                      </div>
                    </div>

                    <div className="mt-2.5 space-y-2">
                      {/* 送料（任意・未入力は一律¥1,000で集計）。原価＝仕入れ値＋送料＝収支の仕入れ累計に反映。 */}
                      <div className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5">
                        <ShippingInput productId={p.id} buyJpy={buyJpy} initial={p.shippingJpy ?? 1000} />
                      </div>
                      {/* 仕入れ元と、eBay自動出品（仕入れ元の写真を取得して候補に入れる）。 */}
                      {p.source?.url && (
                        <a
                          href={p.source.url}
                          target="_blank"
                          rel="nofollow noopener noreferrer"
                          className="flex items-center justify-center gap-1.5 h-9 bg-white border border-[#2D323B]/30 text-[#2D323B] font-bold text-[12px] rounded-xl active:bg-gray-50"
                        >
                          {sourceSiteName(p.source.site)}で見る <ExternalLink size={13} />
                        </a>
                      )}
                      {/* eBay自動出品はプロMAX限定。非対象はアップグレード導線（無在庫転売の入口を絞る・ユーザー指示2026-06-27）。 */}
                      {canList ? (
                        <ListingHelper product={p as ProfitProduct} />
                      ) : (
                        <Link
                          href="/pricing?from=bought"
                          className="flex items-center justify-center gap-1.5 h-10 bg-[#2D323B] text-white font-bold text-[13px] rounded-xl ring-1 ring-[#A98B5C]/60 active:bg-[#1A1D23]"
                        >
                          <Lock size={14} className="text-[#A98B5C]" /> eBay自動出品は<b>プロMAX</b>限定 → プランを見る
                        </Link>
                      )}
                      <div className="flex justify-end">
                        <RemoveBoughtButton productId={p.id} />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
