"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { Product } from "../types";
import { searchRakuten } from "../lib/rakuten";

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";
  const genre = params.get("genre") ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = keyword || genre || "フィギュア おもちゃ";
    searchRakuten(q)
      .then((items) => {
        const sorted = items.sort((a: Product, b: Product) => {
          const bestA = Math.max(...a.profits.map((p) => p.profitRate));
          const bestB = Math.max(...b.profits.map((p) => p.profitRate));
          return bestB - bestA;
        });
        setProducts(sorted);
      })
      .catch((e) => { console.error(e); setProducts([]); })
      .finally(() => setLoading(false));
  }, [keyword, genre]);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/search" className="font-bold text-lg text-indigo-600 shrink-0">輸出で副業しようよ</Link>
          <Link href="/guide" className="text-xs text-gray-500 hover:text-indigo-600 transition-colors ml-auto">はじめてガイド</Link>
        </div>
        <SearchForm defaultKeyword={keyword} />
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-4">
          <h2 className="font-semibold text-gray-900 mb-0.5">
            「{keyword || genre || "すべて"}」の検索結果
          </h2>
          {!loading && (
            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
              <span>{products.length}件 · 最大利益率の高い順</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />利益率30%↑</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />10〜30%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />10%↓</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-12 h-12 bg-gray-200 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
            {products.length === 0 && (
              <p className="text-center text-gray-400 py-12">商品が見つかりませんでした</p>
            )}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">
          ※ 掲載情報は参考値です。実際の利益は商品の状態・競合・送料・手数料などによって異なります。仕入れ前にご自身でご確認ください。
        </p>
      </main>
    </div>
  );
}

export default function ResultsPage() {
  return <Suspense><ResultsContent /></Suspense>;
}
