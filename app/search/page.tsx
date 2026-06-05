"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { GENRES } from "../lib/genres";
import { searchRakuten } from "../lib/rakuten";
import { useEffect, useState } from "react";
import { Product } from "../types";

export default function SearchPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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

        {/* ジャンル選択（ドロップダウン） */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-2">ジャンルから探す</h2>
          <select
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (val === "all") {
                router.push("/results?q=");
              } else {
                const genre = GENRES.find((g) => g.id === val);
                if (genre) router.push(`/results?genre=${genre.id}&q=${encodeURIComponent(genre.label)}`);
              }
            }}
            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 1rem center" }}
          >
            <option value="" disabled>🔍 ジャンルを選んでください</option>
            <option value="all">🔍 すべて</option>
            {GENRES.map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.emoji} {genre.label} — {genre.description}
              </option>
            ))}
          </select>
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
