"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import ProductCard from "../components/ProductCard";
import { Heart } from "lucide-react";
import { fetchProducts } from "../lib/products";
import { ProfitProduct } from "../lib/profitFilter";

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const favIds = Object.keys(localStorage)
      .filter(k => k.startsWith("fav_") && localStorage.getItem(k) === "1")
      .map(k => k.replace("fav_", ""));

    if (favIds.length === 0) {
      setLoading(false);
      return;
    }

    fetchProducts()
      .then(({ products }) => {
        setFavorites(products.filter(p => favIds.includes(p.id)));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header className="bg-[#BF0000]" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 py-3 flex items-center gap-2">
          <Link href="/search" aria-label="検索に戻る"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-white/20 text-white text-xl font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <h1 className="text-white font-black text-base">お気に入り</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto">
        <div className="bg-white border-b border-gray-200 px-3 py-2">
          <p className="text-xs text-gray-600">
            <span className="font-black text-[#BF0000] text-base">{loading ? "-" : favorites.length}</span>
            <span className="ml-0.5">件</span>
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col gap-[1px] bg-gray-200 mt-[1px]">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="bg-white p-3 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-[90px] h-[90px] bg-gray-100 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <div className="text-center py-16 bg-white m-3 border border-gray-200">
            <Heart size={44} className="mx-auto mb-4 text-gray-300" />
            <p className="text-gray-600 text-sm font-semibold mb-1">お気に入りがまだありません</p>
            <p className="text-gray-400 text-xs mb-5">商品カードの ♡ ボタンで追加できます</p>
            <Link href="/search"
              className="inline-flex items-center min-h-[44px] text-sm font-bold text-[#BF0000] border border-[#BF0000] rounded-lg px-5 py-3 active:bg-red-50">
              商品を探す →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-[1px] bg-gray-200 mt-[1px]">
            {favorites.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
