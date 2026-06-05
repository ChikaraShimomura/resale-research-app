"use client";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import { GENRES } from "../lib/genres";
import { fetchProducts, ProductsResponse } from "../lib/products";
import { useEffect, useState } from "react";
import { ProfitProduct } from "../lib/profitFilter";

export default function SearchPage() {
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);

  useEffect(() => {
    fetchProducts()
      .then(({ products, lastUpdated, isSample }) => {
        setProducts(products);
        setLastUpdated(lastUpdated);
        setIsSample(isSample ?? false);
      })
      .finally(() => setLoading(false));
  }, []);

  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = products.filter(p => p.realProfitRate >= 30).length;

  return (
    <div className="min-h-dvh bg-gray-50 pb-nav">

      {/* ヘッダー */}
      <header className="bg-white sticky top-0 z-20 border-b border-gray-100 shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 pt-3 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-black text-lg text-indigo-600 leading-none">輸出で副業しようよ</h1>
              <p className="text-[10px] text-gray-400 mt-0.5">楽天 → eBay 利益商品リサーチ</p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/favorites" className="relative w-8 h-8 flex items-center justify-center text-gray-400 hover:text-rose-500 transition-colors" aria-label="お気に入り">
                <span className="text-xl">❤️</span>
              </Link>
              <Link href="/guide" className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full font-medium">ガイド</Link>
            </div>
          </div>
          <SearchForm />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4">

        {/* はじめてガイドバナー */}
        <Link href="/guide"
          className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl px-4 py-3.5 mb-5 active:opacity-90 transition-opacity shadow-lg shadow-indigo-100">
          <span className="text-2xl">📦</span>
          <div className="flex-1">
            <p className="font-bold text-sm">はじめての方へ：出品ガイド</p>
            <p className="text-xs text-indigo-200 mt-0.5">eBayへの出品と海外発送を解説</p>
          </div>
          <span className="text-indigo-300 text-xl">›</span>
        </Link>

        {/* ジャンルタブ */}
        <div className="mb-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">ジャンルから探す</p>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4">
            <Link href="/results?q="
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-indigo-600 text-white text-xs font-bold shadow-sm shrink-0 active:opacity-80">
              🔍 すべて
            </Link>
            {GENRES.map((genre) => (
              <Link key={genre.id}
                href={`/results?q=${encodeURIComponent(genre.label)}`}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-gray-200 text-gray-600 text-xs font-medium shadow-sm shrink-0 active:bg-gray-50">
                <span>{genre.emoji}</span>
                <span className="whitespace-nowrap">{genre.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* 商品リスト */}
        <div>
          {/* サンプルバナー */}
          {isSample && !loading && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3">
              <span className="text-base">🔔</span>
              <p className="text-xs text-amber-700 font-medium leading-snug">
                現在サンプル商品を表示しています。データ収集が完了すると実際の利益商品に更新されます。
              </p>
            </div>
          )}

          {/* セクションヘッダー */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-gray-800">🔥 利益率ランキング</span>
              {hotCount > 0 && !loading && (
                <span className="text-xs bg-red-50 text-red-500 border border-red-100 px-2 py-0.5 rounded-full font-semibold">
                  利益率30%超 {hotCount}件
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {updatedLabel && (
                <span className="text-xs text-gray-400">{updatedLabel}</span>
              )}
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
          ) : products.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
              <p className="text-5xl mb-4">⏳</p>
              <p className="text-gray-600 text-sm font-semibold mb-1">データ準備中です</p>
              <p className="text-gray-400 text-xs">1日2回自動更新されます</p>
              <div className="mt-4 flex justify-center gap-1">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-indigo-200 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
