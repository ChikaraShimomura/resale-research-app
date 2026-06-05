"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ProductCard from "../components/ProductCard";
import { fetchProducts } from "../lib/products";
import { ProfitProduct } from "../lib/profitFilter";

export default function FavoritesPage() {
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const favIds = Object.keys(localStorage)
      .filter((k) => k.startsWith("fav_") && localStorage.getItem(k) === "1")
      .map((k) => k.replace("fav_", ""));

    if (favIds.length === 0) {
      setLoading(false);
      return;
    }

    fetchProducts()
      .then(({ products }) => {
        setProducts(products.filter((p) => favIds.includes(p.id)));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <Link href="/search" className="font-bold text-xl text-indigo-600">輸出で副業しようよ</Link>
        <Link href="/guide" className="text-xs text-gray-500 hover:text-indigo-600 transition-colors">はじめてガイド</Link>
      </nav>

      <main className="max-w-2xl mx-auto px-4 pt-8 pb-12">
        <div className="flex items-center gap-2 mb-6">
          <h1 className="text-lg font-bold text-gray-900">❤️ お気に入り</h1>
          {!loading && <span className="text-sm text-gray-400">{products.length}件</span>}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => (
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
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🤍</p>
            <p className="text-gray-500 text-sm">まだお気に入りがありません</p>
            <Link href="/search" className="mt-4 inline-block text-indigo-600 text-sm font-medium hover:underline">
              商品を探す →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
