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
  const genre = params.get("genre") ?? "";

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

  // クライアントサイドでキーワード/ジャンルフィルター
  const filtered = useMemo(() => {
    const q = (keyword || genre).toLowerCase().trim();
    if (!q) return allProducts;
    return allProducts.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.coreKeyword ?? "").toLowerCase().includes(q)
    );
  }, [allProducts, keyword, genre]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) =>
      sortOrder === "desc"
        ? b.realProfitRate - a.realProfitRate
        : a.realProfitRate - b.realProfitRate
    ),
    [filtered, sortOrder]
  );

  const displayLabel = keyword || genre || "すべて";
  const updatedLabel = lastUpdated
    ? `更新: ${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <div className="min-h-dvh bg-gray-50 pb-nav">
      <header className="bg-white sticky top-0 z-20 border-b border-gray-100 px-4 pt-3 pb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Link href="/search" className="text-gray-400 text-lg px-1">‹</Link>
          <h1 className="font-bold text-base text-gray-800 flex-1 truncate">「{displayLabel}」の結果</h1>
          <Link href="/favorites" className="text-xl" aria-label="お気に入り">❤️</Link>
        </div>
        <SearchForm defaultKeyword={keyword} />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {loading ? (
              <span>読み込み中…</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-600">{sorted.length}件</span>
                {updatedLabel && <span>{updatedLabel}</span>}
              </div>
            )}
          </div>
          <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-semibold bg-white">
            <button onClick={() => setSortOrder("desc")}
              className={`px-3 py-1.5 transition-colors ${sortOrder === "desc" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
              高い順
            </button>
            <button onClick={() => setSortOrder("asc")}
              className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${sortOrder === "asc" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
              低い順
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 animate-pulse shadow-sm">
                <div className="flex gap-3">
                  <div className="w-16 h-16 bg-gray-100 rounded-xl" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-gray-100 rounded-full w-1/3" />
                    <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                    <div className="h-3 bg-gray-100 rounded-full w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">⏳</p>
            <p className="text-gray-400 text-sm">
              {allProducts.length === 0 ? "データ準備中です" : "該当する商品が見つかりませんでした"}
            </p>
            {allProducts.length === 0 && <p className="text-gray-300 text-xs mt-1">1日2回自動更新されます</p>}
            <Link href="/search" className="mt-4 inline-block text-indigo-600 text-sm font-medium">← 戻る</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-300 leading-relaxed pb-4">
          ※ eBay落札実績価格をもとに計算しています。実際の利益は状態・競合・送料などによって異なります。
        </p>
      </main>

      <BottomNav />
    </div>
  );
}

export default function ResultsPage() {
  return <Suspense><ResultsContent /></Suspense>;
}
