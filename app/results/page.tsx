"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import { fetchProducts } from "../lib/products";
import { ProfitProduct } from "../lib/profitFilter";

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";

  const [allProducts, setAllProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchProducts()
      .then(({ products, lastUpdated }) => {
        setAllProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.toLowerCase().trim();
    if (!q) return allProducts;
    return allProducts.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.coreKeyword ?? "").toLowerCase().includes(q)
    );
  }, [allProducts, keyword]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) =>
      sortOrder === "desc"
        ? b.realProfitRate - a.realProfitRate
        : a.realProfitRate - b.realProfitRate
    ),
    [filtered, sortOrder]
  );

  const displayLabel = keyword || "すべて";
  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = sorted.filter(p => p.realProfitRate >= 30).length;

  return (
    <div className="min-h-dvh bg-[#F5F5F5] pb-nav">

      {/* 楽天風ヘッダー */}
      <header className="bg-[#BF0000] sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 pt-2 pb-1 flex items-center gap-2">
          <Link href="/search"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0 text-lg font-bold">
            ‹
          </Link>
          <div className="flex-1">
            <SearchForm defaultKeyword={keyword} />
          </div>
          <Link href="/favorites" className="text-white/80 shrink-0 text-xl" aria-label="お気に入り">❤️</Link>
        </div>
        {/* 検索結果ラベル */}
        {keyword && (
          <div className="px-3 pb-1.5">
            <span className="text-white/80 text-xs">「{keyword}」の検索結果</span>
          </div>
        )}
      </header>

      {/* 件数・ソートバー（楽天の検索結果ページ風） */}
      <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center justify-between sticky top-[calc(var(--header-h,88px))] z-10">
        <div>
          {loading ? (
            <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p className="text-xs text-gray-600">
              <span className="font-black text-[#BF0000] text-base">{sorted.length}</span>
              <span className="ml-0.5">件</span>
              {hotCount > 0 && (
                <span className="ml-2 text-[11px] text-[#FF6600] font-bold">🔥 {hotCount}件が利益30%超</span>
              )}
            </p>
          )}
          {updatedLabel && <p className="text-[10px] text-gray-400 mt-0.5">{updatedLabel}</p>}
        </div>

        {/* ソートボタン（楽天風タブ） */}
        <div className="flex border border-gray-300 overflow-hidden text-xs font-semibold rounded">
          <button onClick={() => setSortOrder("desc")}
            className={`px-3 py-1.5 transition-colors ${sortOrder === "desc" ? "bg-[#BF0000] text-white" : "bg-white text-gray-500"}`}>
            利益率↓
          </button>
          <button onClick={() => setSortOrder("asc")}
            className={`px-3 py-1.5 border-l border-gray-300 transition-colors ${sortOrder === "asc" ? "bg-[#BF0000] text-white" : "bg-white text-gray-500"}`}>
            利益率↑
          </button>
        </div>
      </div>

      <main className="max-w-2xl mx-auto">
        {loading ? (
          <div className="flex flex-col gap-[1px] bg-gray-200 mt-[1px]">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white p-3 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-[90px] h-[90px] bg-gray-100 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                    <div className="h-5 bg-gray-100 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 bg-white m-3 border border-gray-200">
            <p className="text-5xl mb-4">
              {allProducts.length === 0 ? "⏳" : "🔍"}
            </p>
            <p className="text-gray-600 text-sm font-semibold mb-1">
              {allProducts.length === 0 ? "利益商品を探しています" : `「${displayLabel}」の商品が見つかりませんでした`}
            </p>
            {allProducts.length === 0
              ? <p className="text-gray-400 text-xs"></p>
              : <p className="text-gray-400 text-xs">別のキーワードで検索してみてください</p>
            }
            <Link href="/search" className="mt-5 inline-block text-sm font-bold text-[#BF0000] border border-[#BF0000] px-5 py-2">
              ← ホームに戻る
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-[1px] bg-gray-200 mt-[1px]">
            {sorted.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {!loading && sorted.length > 0 && (
          <p className="px-3 py-4 text-[10px] text-gray-400 leading-relaxed text-center">
            ※ eBay落札実績価格をもとに計算しています。実際の利益は状態・競合・送料などによって異なります。
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
