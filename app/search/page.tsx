"use client";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { GENRES } from "../lib/genres";
import { searchRakuten } from "../lib/rakuten";
import { useEffect, useState } from "react";
import { filterProfitable, ProfitProduct } from "../lib/profitFilter";

export default function SearchPage() {
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProducts([]);

    searchRakuten("フィギュア おもちゃ")
      .then((items) => {
        if (cancelled) return;
        setProgress({ checked: 0, total: items.length });
        return filterProfitable(items, (found, checked, total) => {
          if (cancelled) return;
          // 利益率順にソートしながら随時更新
          const sorted = [...found].sort((a, b) => b.realProfitRate - a.realProfitRate);
          setProducts(sorted);
          setProgress({ checked, total });
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white sticky top-0 z-20 border-b border-gray-100 px-4 pt-4 pb-3 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-bold text-lg text-indigo-600">輸出で副業しようよ</h1>
          <div className="flex items-center gap-3">
            <Link href="/favorites" className="text-xl" aria-label="お気に入り">❤️</Link>
            <Link href="/guide" className="text-xs text-gray-500 font-medium">ガイド</Link>
          </div>
        </div>
        <SearchForm />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5">
        {/* はじめてガイドバナー */}
        <Link href="/guide"
          className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-2xl px-4 py-3.5 mb-5 active:opacity-90 transition-opacity shadow-md shadow-indigo-100">
          <span className="text-2xl">📦</span>
          <div className="flex-1">
            <p className="font-bold text-sm">はじめての方へ：出品ガイド</p>
            <p className="text-xs text-indigo-200 mt-0.5">eBay・メルカリへの出品と海外発送を解説</p>
          </div>
          <span className="text-indigo-300 text-xl">›</span>
        </Link>

        {/* ジャンル */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ジャンルから探す</p>
          <div className="flex flex-wrap gap-1.5">
            <Link href="/results?q="
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-xs font-semibold shadow-sm active:opacity-80">
              🔍 すべて
            </Link>
            {GENRES.map((genre) => (
              <Link key={genre.id}
                href={`/results?genre=${genre.id}&q=${encodeURIComponent(genre.label)}`}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 text-xs font-medium shadow-sm active:bg-gray-50">
                {genre.emoji} {genre.label}
              </Link>
            ))}
          </div>
        </div>

        {/* 商品リスト */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-gray-700">🔥 利益率ランキング</p>
            <div className="flex items-center gap-2">
              {(loading || progress.checked < progress.total) && progress.total > 0 && (
                <span className="text-xs text-gray-400">
                  確認中 {progress.checked}/{progress.total}
                </span>
              )}
              {products.length > 0 && (
                <span className="text-xs text-gray-400">{products.length}件</span>
              )}
            </div>
          </div>

          {/* ローディング（初期） */}
          {loading && products.length === 0 && (
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
          )}

          {/* 商品カード */}
          <div className="flex flex-col gap-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          {/* 完了後0件 */}
          {!loading && products.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">😅</p>
              <p className="text-gray-400 text-sm">利益が出る商品が見つかりませんでした</p>
            </div>
          )}
        </div>
      </main>

      {/* ボトムナビ */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex items-center justify-around px-2 py-2 z-20 shadow-lg">
        <Link href="/search" className="flex flex-col items-center gap-0.5 px-4 py-1 text-indigo-600">
          <span className="text-xl">🏠</span>
          <span className="text-xs font-semibold">ホーム</span>
        </Link>
        <Link href="/results?q=" className="flex flex-col items-center gap-0.5 px-4 py-1 text-gray-400">
          <span className="text-xl">🔍</span>
          <span className="text-xs font-medium">検索</span>
        </Link>
        <Link href="/favorites" className="flex flex-col items-center gap-0.5 px-4 py-1 text-gray-400">
          <span className="text-xl">❤️</span>
          <span className="text-xs font-medium">お気に入り</span>
        </Link>
        <Link href="/guide" className="flex flex-col items-center gap-0.5 px-4 py-1 text-gray-400">
          <span className="text-xl">📖</span>
          <span className="text-xs font-medium">ガイド</span>
        </Link>
      </nav>
    </div>
  );
}
