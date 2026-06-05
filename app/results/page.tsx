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
    <div className="min-h-dvh bg-gray-50 pb-nav">
      <header className="bg-white sticky top-0 z-20 border-b border-gray-100 shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 pt-3 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <Link href="/search" className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 shrink-0">
              <span className="text-lg leading-none">‹</span>
            </Link>
            <h1 className="font-bold text-sm text-gray-800 flex-1 truncate">
              「{displayLabel}」の検索結果
            </h1>
            <Link href="/favorites" className="text-xl shrink-0" aria-label="お気に入り">❤️</Link>
          </div>
          <SearchForm defaultKeyword={keyword} />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4">
        {/* 結果サマリー＋ソート（Yahoo!フリマ風） */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {loading ? (
              <div className="h-4 w-20 bg-gray-100 rounded-full animate-pulse" />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-700">{sorted.length}件</span>
                {hotCount > 0 && (
                  <span className="text-xs bg-red-50 text-red-500 border border-red-100 px-2 py-0.5 rounded-full font-semibold">
                    🔥 {hotCount}件が利益率30%超
                  </span>
                )}
              </div>
            )}
            {updatedLabel && (
              <span className="text-xs text-gray-400">{updatedLabel}</span>
            )}
          </div>

          {/* ソートボタン */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-semibold bg-white shadow-sm">
            <button onClick={() => setSortOrder("desc")}
              className={`px-3 py-1.5 transition-colors ${sortOrder === "desc" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
              利益率↓
            </button>
            <button onClick={() => setSortOrder("asc")}
              className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${sortOrder === "asc" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
              利益率↑
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 animate-pulse shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                <div className="flex gap-3">
                  <div className="w-20 h-20 bg-gray-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="flex justify-between">
                      <div className="h-3 bg-gray-100 rounded-full w-1/4" />
                      <div className="h-6 bg-gray-100 rounded-full w-16" />
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                    <div className="h-3 bg-gray-100 rounded-full w-1/2" />
                  </div>
                </div>
                <div className="mt-3 h-14 bg-gray-50 rounded-xl" />
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <p className="text-5xl mb-4">
              {allProducts.length === 0 ? "⏳" : "🔍"}
            </p>
            <p className="text-gray-600 text-sm font-semibold mb-1">
              {allProducts.length === 0 ? "データ準備中です" : `「${displayLabel}」の商品が見つかりませんでした`}
            </p>
            {allProducts.length === 0
              ? <p className="text-gray-400 text-xs">1日2回自動更新されます</p>
              : <p className="text-gray-400 text-xs">別のキーワードで検索してみてください</p>
            }
            <Link href="/search" className="mt-5 inline-block text-sm font-semibold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl">
              ← ホームに戻る
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {!loading && sorted.length > 0 && (
          <p className="mt-6 text-xs text-gray-300 leading-relaxed pb-4 text-center">
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
