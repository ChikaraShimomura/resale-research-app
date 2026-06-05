"use client";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { GENRES } from "../lib/genres";
import { searchRakuten } from "../lib/rakuten";
import { useEffect, useState } from "react";
import { Product } from "../types";

export default function SearchPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchRakuten("フィギュア おもちゃ ゲーム アニメ")
      .then((items) => {
        const sorted = items.sort((a, b) =>
          Math.max(...b.profits.map((p) => p.profitRate)) -
          Math.max(...a.profits.map((p) => p.profitRate))
        );
        setProducts(sorted);
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl text-indigo-600">輸出で副業しようよ</Link>
        <div className="flex items-center gap-3">
          <Link href="/favorites" className="text-xs text-gray-500 hover:text-pink-500 transition-colors">❤️ お気に入り</Link>
          <Link href="/guide" className="text-xs text-gray-500 hover:text-indigo-600 transition-colors">はじめてガイド</Link>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 pt-8 pb-12">

        {/* はじめてガイドバナー */}
        <Link href="/guide" className="flex items-center gap-3 bg-indigo-600 text-white rounded-2xl px-4 py-3.5 mb-6 hover:bg-indigo-700 transition-colors">
          <span className="text-2xl">📦</span>
          <div className="flex-1">
            <p className="font-bold text-sm">はじめての方へ：出品ガイド</p>
            <p className="text-xs text-indigo-200 mt-0.5">eBay・メルカリへの出品と海外発送をわかりやすく解説</p>
          </div>
          <span className="text-indigo-300 text-lg">›</span>
        </Link>

        {/* ジャンル一覧 */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">ジャンルから探す</h2>
          <div className="grid grid-cols-4 gap-2">
            <Link
              href="/results?q="
              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-600 text-center transition-all hover:shadow-sm active:scale-95"
            >
              <span className="text-lg">🔍</span>
              <span className="text-xs font-semibold">すべて</span>
            </Link>
            {GENRES.map((genre) => (
              <Link
                key={genre.id}
                href={`/results?genre=${genre.id}&q=${encodeURIComponent(genre.label)}`}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border-2 text-center transition-all hover:shadow-sm active:scale-95 ${genre.color}`}
              >
                <span className="text-lg">{genre.emoji}</span>
                <span className="text-xs font-semibold leading-tight">{genre.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* キーワード検索 */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-2">
            <span className="flex-1 border-t border-gray-200" />
            商品名で検索
            <span className="flex-1 border-t border-gray-200" />
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <SearchForm />
          </div>
        </div>

        {/* ピックアップ商品 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">ピックアップ商品</h2>
          {loading ? (
            <div className="flex flex-col gap-3">
              {[...Array(4)].map((_, i) => (
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
              {products.slice(0, 10).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
