"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { mockProducts } from "../lib/mock-data";
import { isSoldExpired } from "../lib/utils";

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";

  const sorted = [...mockProducts].filter((p) => !isSoldExpired(p.soldAt)).sort((a, b) => {
    const bestA = Math.max(...a.profits.map(p => p.profitRate));
    const bestB = Math.max(...b.profits.map(p => p.profitRate));
    return bestB - bestA;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/" className="font-bold text-lg text-indigo-600 shrink-0">輸出で副業しようよ</Link>
          <Link href="/guide" className="text-xs text-gray-500 hover:text-indigo-600 transition-colors ml-auto">はじめてガイド</Link>
        </div>
        <SearchForm defaultKeyword={keyword} />
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-4">
          <h2 className="font-semibold text-gray-900 mb-0.5">
            「{keyword || "すべて"}」の検索結果
          </h2>
          <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
            <span>{sorted.length}件 · 最大利益率の高い順</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />利益率30%↑</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />10〜30%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />10%↓</span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {sorted.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

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
