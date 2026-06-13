"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import { fetchProducts } from "../lib/products";
import { ProfitProduct } from "../lib/profitFilter";
import { SortOrder, sortProducts } from "../components/SortSelect";
import ListControls from "../components/ListControls";
import { isSold, withSoldDummies } from "../lib/sold";
import { fetchSoldIds } from "../lib/ebaySold";
import { readUnlockedIds, pinUnlockedFirst } from "../lib/unlocked";
import { logEvent } from "../lib/analytics";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import { Heart, Flame, PackageSearch, Search } from "lucide-react";

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";

  const [allProducts, setAllProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  // "default" = 登録順（新着順）。利益率ソートは将来の有料機能
  const [sortOrder, setSortOrder] = useState<SortOrder>("default");
  const [hideSold, setHideSold] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // 自分がeBayで売れた商品ID（端末単位）。最下部化/非表示に使う。
  const [soldIds, setSoldIds] = useState<Set<string>>(new Set());
  // 「楽天で仕入れる」を押した（=eBay簡単出品アクティブ）商品ID。先頭固定に使う。
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetchProducts()
      .then(({ products, lastUpdated }) => {
        setAllProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  // eBayで売れた商品を取得（連携済みのみ。未連携なら空セット）
  useEffect(() => {
    fetchSoldIds().then((s) => setSoldIds(s.ids)).catch(() => {});
  }, []);

  // アクティブ（仕入れ中）商品IDを localStorage から取得（先頭固定用）＋一覧閲覧を記録
  useEffect(() => {
    setUnlockedIds(readUnlockedIds());
    try { localStorage.setItem("ob_viewed", "1"); } catch { /* noop */ }
    logEvent("results_view"); // 一覧閲覧（ファネル計測）
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.toLowerCase().trim();
    if (!q) return allProducts;
    return allProducts.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.coreKeyword ?? "").toLowerCase().includes(q)
    );
  }, [allProducts, keyword]);

  const sorted = useMemo(() => {
    const base = hideSold ? filtered.filter((p) => !isSold(p)) : withSoldDummies(filtered);
    const arr = sortProducts(base, sortOrder);
    // eBayで売れた商品：「SOLDを除外」時は隠し、通常時は最下部へ沈める（並び順は維持）
    let ordered: ProfitProduct[];
    if (soldIds.size === 0) {
      ordered = arr;
    } else if (hideSold) {
      ordered = arr.filter((p) => !soldIds.has(p.id));
    } else {
      const live = arr.filter((p) => !soldIds.has(p.id));
      const sold = arr.filter((p) => soldIds.has(p.id));
      ordered = [...live, ...sold];
    }
    // 「楽天で仕入れる」を押した商品（eBay簡単出品アクティブ）を先頭に固定
    return pinUnlockedFirst(ordered, unlockedIds, soldIds);
  }, [filtered, sortOrder, hideSold, soldIds, unlockedIds]);

  // ページネーション（30件/ページ）。並び替え・フィルタ・キーワード変更で1ページ目へ
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [sortOrder, hideSold, keyword]);
  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, pageCount)); // 非同期でリストが縮んでも空ページを出さない
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const displayLabel = keyword || "すべて";
  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = sorted.filter(p => p.realProfitRate >= 30).length;

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] sticky top-0 z-20 shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 pt-2 pb-2 flex items-center gap-2">
          <Link href="/search"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0 text-lg font-bold hover:bg-white/30 transition-colors">
            ‹
          </Link>
          <div className="flex-1">
            <SearchForm defaultKeyword={keyword} />
          </div>
          <Link href="/favorites" className="text-white/80 shrink-0 flex items-center" aria-label="お気に入り"><Heart size={20} /></Link>
        </div>
        {keyword && (
          <div className="px-3 pb-1.5">
            <span className="text-white/80 text-xs">「{keyword}」の検索結果</span>
          </div>
        )}
      </header>

      {/* 件数・ソート/SOLD除外バー */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-start justify-between gap-3 sticky top-[calc(var(--header-h,88px))] z-10 shadow-sm">
        <div className="min-w-0">
          {loading ? (
            <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <p className="text-xs text-gray-500">
              <span className="font-black text-[#BF0000] text-base">{sorted.length}</span>
              <span className="ml-0.5">件</span>
              {hotCount > 0 && (
                <span className="ml-2 text-[11px] text-[#FF4466] font-bold inline-flex items-center gap-1"><Flame size={12} />{hotCount}件が利益30%超</span>
              )}
            </p>
          )}
          {updatedLabel && <p className="text-[10px] text-gray-400 mt-0.5">{updatedLabel}</p>}
        </div>

        <ListControls sortOrder={sortOrder} onSortChange={setSortOrder} hideSold={hideSold} onHideSoldChange={setHideSold} />
      </div>

      <main className="max-w-2xl mx-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse shadow-sm">
                <div className="flex gap-3">
                  <div className="w-[88px] h-[88px] bg-gray-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                    <div className="h-3 bg-gray-100 rounded-full w-1/2" />
                    <div className="h-5 bg-gray-100 rounded-full w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 bg-white m-3 rounded-2xl shadow-sm border border-gray-100">
            {allProducts.length === 0
              ? <PackageSearch size={44} className="mx-auto mb-4 text-gray-300" />
              : <Search size={44} className="mx-auto mb-4 text-gray-300" />}
            <p className="text-gray-600 text-sm font-semibold mb-1">
              {allProducts.length === 0 ? "いま掲載できる商品がありません" : `「${displayLabel}」の商品が見つかりませんでした`}
            </p>
            {allProducts.length === 0
              ? <p className="text-gray-400 text-xs">時間をおいて、もう一度開いてみてください。</p>
              : <p className="text-gray-400 text-xs">別のキーワードで検索してみてください</p>
            }
            <Link href="/search"
              className="mt-5 inline-block text-sm font-bold text-[#BF0000] border border-[#BF0000] px-5 py-2 rounded-full">
              ← ホームに戻る
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 p-3">
              {pageItems.map((product) => (
                <ProductCard key={product.id} product={product} ebaySold={soldIds.has(product.id)} />
              ))}
            </div>
            <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
          </>
        )}

        {!loading && sorted.length > 0 && (
          <p className="px-4 py-5 text-[10px] text-gray-400 leading-relaxed text-center">
            ※ eBay相場価格（現在の出品ベース）をもとに計算しています。実際の利益は状態・競合・送料などによって異なります。
          </p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

export default function ResultsPage() {
  return <Suspense><ResultsContent /></Suspense>;
}
