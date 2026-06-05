"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { Product } from "../types";
import { searchRakuten } from "../lib/rakuten";

const GENRE_KEYWORDS: Record<string, string> = {
  "trading-card":   "トレカ ポケモンカード 遊戯王",
  "gunpla":         "ガンプラ MG RG HG",
  "lego":           "LEGO レゴ",
  "game":           "ゲーム Switch PS5",
  "cosme":          "コスメ スキンケア 日焼け止め",
  "figure":         "フィギュア アニメ",
  "toy":            "おもちゃ キャラクター",
  "electronics":    "家電 ガジェット イヤホン",
  "sports":         "スポーツ シューズ",
  "fashion":        "ファッション ブランド",
  "cd-record":      "CD レコード アニソン",
  "manga":          "漫画 全巻 画集",
  "watch":          "腕時計 セイコー シチズン",
  "japanese-craft": "和雑貨 工芸 着物",
  "board-game":     "ボードゲーム",
  "camera":         "カメラ フィルムカメラ レンズ",
  "sneaker":        "スニーカー 限定",
  "instrument":     "楽器 ギター エフェクター",
};

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";
  const genre = params.get("genre") ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const sorted = [...products].sort((a, b) => {
    const bestA = Math.max(...a.profits.map((p) => p.profitRate));
    const bestB = Math.max(...b.profits.map((p) => p.profitRate));
    return sortOrder === "desc" ? bestB - bestA : bestA - bestB;
  });

  useEffect(() => {
    setLoading(true);
    const q = keyword || (genre ? GENRE_KEYWORDS[genre] ?? genre : "フィギュア おもちゃ");
    searchRakuten(q)
      .then((items) => setProducts(items))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [keyword, genre]);

  const displayLabel = keyword || genre || "すべて";

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white sticky top-0 z-20 border-b border-gray-100 px-4 pt-3 pb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Link href="/search" className="text-gray-400 text-lg px-1">‹</Link>
          <h1 className="font-bold text-base text-gray-800 flex-1 truncate">「{displayLabel}」の結果</h1>
          <Link href="/favorites" className="text-xl" aria-label="お気に入り">❤️</Link>
        </div>
        <SearchForm defaultKeyword={keyword} />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4">
        {/* ソート＆件数バー */}
        {!loading && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="font-semibold text-gray-600">{sorted.length}件</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />30%↑</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />10〜30%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />10%↓</span>
            </div>
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-semibold bg-white">
              <button onClick={() => setSortOrder("desc")}
                className={`px-3 py-1.5 transition-colors ${sortOrder === "desc" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
                高い順
              </button>
              <button onClick={() => setSortOrder("asc")}
                className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${sortOrder === "asc" ? "bg-indigo-600 text-white" : "text-gray-400"}`}>
                低い順
              </button>
            </div>
          </div>
        )}

        {/* 商品リスト */}
        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(5)].map((_, i) => (
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
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
            {products.length === 0 && (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">🔍</p>
                <p className="text-gray-400 text-sm">商品が見つかりませんでした</p>
                <Link href="/search" className="mt-4 inline-block text-indigo-600 text-sm font-medium">← 戻る</Link>
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-300 leading-relaxed pb-4">
          ※ 掲載情報は参考値です。実際の利益は商品の状態・競合・送料・手数料などによって異なります。
        </p>
      </main>

      {/* ボトムナビ */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex items-center justify-around px-2 py-2 z-20 shadow-lg">
        <Link href="/search" className="flex flex-col items-center gap-0.5 px-4 py-1 text-gray-400">
          <span className="text-xl">🏠</span>
          <span className="text-xs font-medium">ホーム</span>
        </Link>
        <Link href="/results?q=" className="flex flex-col items-center gap-0.5 px-4 py-1 text-indigo-600">
          <span className="text-xl">🔍</span>
          <span className="text-xs font-semibold">検索</span>
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

export default function ResultsPage() {
  return <Suspense><ResultsContent /></Suspense>;
}
