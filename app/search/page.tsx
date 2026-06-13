"use client";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import { fetchProducts } from "../lib/products";
import { useEffect, useState } from "react";
import { ProfitProduct } from "../lib/profitFilter";
import { SortOrder, sortProducts } from "../components/SortSelect";
import ListControls from "../components/ListControls";
import { isSold, withSoldDummies } from "../lib/sold";
import { readUnlockedIds, pinUnlockedFirst } from "../lib/unlocked";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import { Flame, PackageSearch } from "lucide-react";

export default function SearchPage() {
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(true); // 初期はtrueでチラつき防止
  const [sortOrder, setSortOrder] = useState<SortOrder>("default");
  const [hideSold, setHideSold] = useState(false);
  // 「楽天で仕入れる」を押した（=eBay簡単出品アクティブ）商品ID。先頭固定に使う。
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBannerDismissed(localStorage.getItem("spu_banner_dismissed") === "1");
    setUnlockedIds(readUnlockedIds());
    try { localStorage.setItem("ob_viewed", "1"); } catch { /* noop */ }
    fetchProducts()
      .then(({ products, lastUpdated }) => {
        setProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  const dismissBanner = () => {
    localStorage.setItem("spu_banner_dismissed", "1");
    setBannerDismissed(true);
  };

  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = products.filter(p => p.realProfitRate >= 30).length;
  // SOLD以外のみ表示ならフィルタ、そうでなければ SOLD が10未満のときダミーSOLDを点在
  const baseList = hideSold ? products.filter(p => !isSold(p)) : withSoldDummies(products);
  // 「楽天で仕入れる」を押した商品（eBay簡単出品アクティブ）を先頭に固定
  const sortedProducts = pinUnlockedFirst(sortProducts(baseList, sortOrder), unlockedIds);

  // ページネーション（30件/ページ）。並び替え・フィルタ変更時は1ページ目に戻す
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [sortOrder, hideSold]);
  const pageCount = Math.ceil(sortedProducts.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, pageCount)); // 非同期でリストが縮んでも空ページを出さない
  const pageItems = sortedProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* 楽天風ヘッダー（スクロールしても固定） */}
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] shadow-sm sticky top-0 z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        {/* ロゴ行 */}
        <div className="px-3 pt-2 pb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 楽天風ロゴ */}
            <div className="flex items-center gap-1">
              <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                <span className="text-[#BF0000] font-black text-sm leading-none">R</span>
              </div>
              <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/favorites" className="w-11 h-11 -mr-1 flex items-center justify-center text-white/80 hover:text-white active:scale-95" aria-label="お気に入り">
              <Heart16 />
            </Link>
            <Link href="/settings" className="w-11 h-11 -mr-1 flex items-center justify-center text-white/80 hover:text-white active:scale-95" aria-label="設定">
              <Gear16 />
            </Link>
            <Link href="/guide" className="inline-flex items-center min-h-[36px] text-[11px] text-white/90 border border-white/40 px-3.5 py-1.5 rounded-full active:bg-white/10">ガイド</Link>
          </div>
        </div>
        {/* 検索バー */}
        <div className="px-3 pb-2.5">
          <SearchForm />
        </div>
      </header>

      <main className="max-w-2xl mx-auto">

        {/* ポイントキャンペーンバナー（白基調＋クリムゾン差し色。ヘッダーの赤と衝突しないクリーンな配色） */}
        {!bannerDismissed && (
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-[#BF0000] rounded-full flex items-center justify-center shrink-0">
              <span className="text-white font-black text-base leading-none">R</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-gray-900 font-black text-sm">楽天×eBayで稼ぐ</p>
              <p className="text-gray-500 text-xs leading-snug">仕入れで最大20%ポイント還元 ＋ 海外で高値売却</p>
            </div>
            <Link href="/guide" className="text-[11px] font-bold text-[#BF0000] border border-[#BF0000] px-3 py-1.5 rounded-full shrink-0 active:bg-[#BF0000]/5">
              使い方 ›
            </Link>
            <button onClick={dismissBanner} aria-label="バナーを閉じる"
              className="w-9 h-9 -mr-1.5 flex items-center justify-center text-gray-400 hover:text-gray-600 active:scale-90 shrink-0 text-lg leading-none">
              ×
            </button>
          </div>
        )}


        {/* セクションヘッダー（件数 + 右に並び替え/SOLD除外を上下配置） */}
        <div className="bg-white px-4 py-2.5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {loading ? (
              <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
            ) : (
              <p className="text-xs text-gray-500">
                <span className="font-black text-[#BF0000] text-base">{products.length}</span>
                <span className="ml-0.5">件の利益商品</span>
                {hotCount > 0 && (
                  <span className="ml-2 text-[13px] text-[#FF4466] font-bold inline-flex items-center gap-1"><Flame size={13} />{hotCount}件が利益30%超</span>
                )}
              </p>
            )}
            {updatedLabel && (
              <p className="text-[11px] text-gray-400 mt-0.5">{updatedLabel}</p>
            )}
          </div>
          <ListControls sortOrder={sortOrder} onSortChange={setSortOrder} hideSold={hideSold} onHideSoldChange={setHideSold} />
        </div>

        <div className="px-0">
          {loading ? (
            <div className="flex flex-col gap-3 p-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-[90px] h-[90px] bg-gray-100 rounded-xl shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                      <div className="h-3 bg-gray-100 rounded-full w-1/2" />
                      <div className="h-5 bg-gray-100 rounded-full w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 bg-white m-3 rounded-2xl border border-gray-100 shadow-sm">
              <PackageSearch size={44} className="mx-auto mb-4 text-gray-300" />
              <p className="text-gray-600 text-sm font-semibold mb-1">いま掲載できる商品がありません</p>
              <p className="text-gray-400 text-xs mb-5">時間をおいて、もう一度開いてみてください。</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="text-sm font-bold text-[#BF0000] border border-[#BF0000] px-5 py-2 rounded-full active:bg-red-50"
                >
                  再読み込み
                </button>
                <Link href="/guide" className="text-sm font-bold text-gray-500 px-5 py-2">
                  使い方を見る
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 p-3">
                {pageItems.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
            </>
          )}
        </div>

        {!loading && products.length > 0 && (
          <p className="px-4 py-5 text-[11px] text-gray-400 leading-relaxed text-center">
            ※ eBay相場価格・楽天ポイント・eBay手数料(13.25%)をもとに計算しています（国際送料は購入者負担のため利益に含めません）。<br />
            実際の利益は状態・競合・送料などによって異なります。
          </p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function Heart16() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function Gear16() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
