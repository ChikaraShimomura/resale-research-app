"use client";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import { GENRES } from "../lib/genres";
import { fetchProducts } from "../lib/products";
import { useEffect, useState } from "react";
import { ProfitProduct } from "../lib/profitFilter";

export default function SearchPage() {
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts()
      .then(({ products, lastUpdated }) => {
        setProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = products.filter(p => p.realProfitRate >= 30).length;

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* 楽天風ヘッダー */}
      <header className="bg-gradient-to-r from-[#CC0033] to-[#E8003A] shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        {/* ロゴ行 */}
        <div className="px-3 pt-2 pb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 楽天風ロゴ */}
            <div className="flex items-center gap-1">
              <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                <span className="text-[#CC0033] font-black text-sm leading-none">R</span>
              </div>
              <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/favorites" className="w-11 h-11 -mr-1 flex items-center justify-center text-white/80 hover:text-white active:scale-95" aria-label="お気に入り">
              <Heart16 />
            </Link>
            <Link href="/guide" className="inline-flex items-center min-h-[36px] text-[11px] text-white/80 border border-white/40 px-3 py-1.5 rounded active:bg-white/10">ガイド</Link>
          </div>
        </div>
        {/* 検索バー */}
        <div className="px-3 pb-2.5">
          <SearchForm />
        </div>
      </header>

      <main className="max-w-2xl mx-auto">

        {/* ポイントキャンペーンバナー（楽天のSPUバナー風） */}
        <div className="bg-gradient-to-r from-[#FF4466] to-[#FF6688] px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shrink-0">
            <span className="text-[#FF4466] font-black text-lg leading-none">R</span>
          </div>
          <div className="flex-1">
            <p className="text-white font-black text-sm">楽天ポイント × eBay転売で稼ぐ</p>
            <p className="text-white/80 text-xs">仕入れで最大20%ポイント還元 + 海外で高値売却</p>
          </div>
          <Link href="/guide" className="text-[11px] font-bold text-white bg-white/20 px-2.5 py-1.5 rounded shrink-0">
            使い方 ›
          </Link>
        </div>

        {/* カテゴリタブ（楽天ショッピングのタブ風） */}
        <div className="bg-white border-b border-gray-200">
          <div className="flex gap-0 overflow-x-auto scrollbar-hide">
            <Link href="/results?q="
              className="shrink-0 inline-flex items-center min-h-[44px] px-4 text-xs font-bold text-[#CC0033] border-b-2 border-[#CC0033] bg-white whitespace-nowrap">
              すべて
            </Link>
            {GENRES.map((genre) => (
              <Link key={genre.id}
                href={`/results?q=${encodeURIComponent(genre.label)}`}
                className="shrink-0 inline-flex items-center min-h-[44px] px-4 text-xs font-medium text-gray-500 border-b-2 border-transparent hover:text-[#CC0033] active:text-[#CC0033] whitespace-nowrap">
                {genre.emoji} {genre.label}
              </Link>
            ))}
          </div>
        </div>

        {/* セクションヘッダー（楽天風の「件数+ソート」行） */}
        <div className="bg-white px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {loading ? (
              <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
            ) : (
              <p className="text-xs text-gray-600">
                <span className="font-black text-[#CC0033] text-base">{products.length}</span>
                <span className="ml-0.5">件の利益商品</span>
                {hotCount > 0 && (
                  <span className="ml-2 text-[13px] text-[#FF4466] font-bold">🔥 {hotCount}件が利益30%超</span>
                )}
              </p>
            )}
          </div>
          {updatedLabel && (
            <span className="text-[11px] text-gray-500">{updatedLabel}</span>
          )}
        </div>

        <div className="px-0">
          {loading ? (
            <div className="flex flex-col gap-2 p-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white border rounded-2xl border border-gray-100 p-4 shadow-sm animate-pulse">
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
          ) : products.length === 0 ? (
            <div className="text-center py-16 bg-white m-3 rounded-2xl border border-gray-100 shadow-sm">
              <p className="text-5xl mb-4">⏳</p>
              <p className="text-gray-600 text-sm font-semibold mb-1">利益商品を探しています</p>
              <p className="text-gray-400 text-xs"></p>
              <div className="mt-4 flex justify-center gap-1">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-[#CC0033]/30 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>

        {!loading && products.length > 0 && (
          <p className="px-3 py-4 text-[11px] text-gray-500 leading-relaxed text-center">
            ※ eBay落札実績価格・楽天ポイント・eBay手数料(13.25%)・国際送料(¥2,500)をもとに計算しています。<br />
            実際の利益は状態・競合・送料などによって異なります。
          </p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function Heart16() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
