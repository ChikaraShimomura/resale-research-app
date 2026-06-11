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
  // "default" = 登録順（新着順）。利益率ソートは将来の有料機能
  const [sortOrder, setSortOrder] = useState<"default" | "desc" | "asc">("default");
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

  const sorted = useMemo(() => {
    // 登録順（API が返す新着順）をそのまま表示
    if (sortOrder === "default") return filtered;
    return [...filtered].sort((a, b) =>
      sortOrder === "desc"
        ? b.realProfitRate - a.realProfitRate
        : a.realProfitRate - b.realProfitRate
    );
  }, [filtered, sortOrder]);

  const displayLabel = keyword || "すべて";
  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = sorted.filter(p => p.realProfitRate >= 30).length;

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-[#CC0033] to-[#E8003A] sticky top-0 z-20 shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 pt-2 pb-2 flex items-center gap-2">
          <Link href="/search"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0 text-lg font-bold hover:bg-white/30 transition-colors">
            ‹
          </Link>
          <div className="flex-1">
            <SearchForm defaultKeyword={keyword} />
          </div>
          <Link href="/favorites" className="text-white/80 shrink-0 text-xl" aria-label="お気に入り">❤️</Link>
        </div>
        {keyword && (
          <div className="px-3 pb-1.5">
            <span className="text-white/80 text-xs">「{keyword}」の検索結果</span>
          </div>
        )}
      </header>

      {/* 件数・ソートバー */}
      <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between sticky top-[calc(var(--header-h,88px))] z-10 shadow-sm">
        <div>
          {loading ? (
            <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <p className="text-xs text-gray-600">
              <span className="font-black text-[#CC0033] text-base">{sorted.length}</span>
              <span className="ml-0.5">件</span>
              {hotCount > 0 && (
                <span className="ml-2 text-[11px] text-[#FF4466] font-bold">🔥 {hotCount}件が利益30%超</span>
              )}
            </p>
          )}
          {updatedLabel && <p className="text-[10px] text-gray-400 mt-0.5">{updatedLabel}</p>}
        </div>

        {/* ソートボタン（登録順がデフォルト。利益率ソートは将来の有料機能） */}
        <div className="flex border border-gray-200 overflow-hidden text-xs font-semibold rounded-xl shadow-sm">
          <button onClick={() => setSortOrder("default")}
            aria-pressed={sortOrder === "default"}
            className={`inline-flex items-center min-h-[44px] px-3 transition-colors ${sortOrder === "default" ? "bg-[#CC0033] text-white" : "bg-white text-gray-500 active:bg-gray-50"}`}>
            登録順
          </button>
          {/* TODO: 課金導入時はここをペイウォールでゲートする */}
          <button onClick={() => setSortOrder("desc")}
            aria-pressed={sortOrder === "desc"}
            className={`inline-flex items-center gap-0.5 min-h-[44px] px-3 border-l border-gray-200 transition-colors ${sortOrder === "desc" ? "bg-[#CC0033] text-white" : "bg-white text-gray-500 active:bg-gray-50"}`}>
            利益率↓<span className="text-[9px] opacity-70">🔒</span>
          </button>
          <button onClick={() => setSortOrder("asc")}
            aria-pressed={sortOrder === "asc"}
            className={`inline-flex items-center gap-0.5 min-h-[44px] px-3 border-l border-gray-200 transition-colors ${sortOrder === "asc" ? "bg-[#CC0033] text-white" : "bg-white text-gray-500 active:bg-gray-50"}`}>
            利益率↑<span className="text-[9px] opacity-70">🔒</span>
          </button>
        </div>
      </div>

      <main className="max-w-2xl mx-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 animate-pulse shadow-sm">
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
            <Link href="/search"
              className="mt-5 inline-block text-sm font-bold text-[#CC0033] border border-[#CC0033] px-5 py-2 rounded-full">
              ← ホームに戻る
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3">
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
