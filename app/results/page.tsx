"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import { searchRakuten } from "../lib/rakuten";
import { filterProfitable, ProfitProduct } from "../lib/profitFilter";

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

  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const sorted = [...products].sort((a, b) =>
    sortOrder === "desc"
      ? b.realProfitRate - a.realProfitRate
      : a.realProfitRate - b.realProfitRate
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProducts([]);

    const q = keyword || (genre ? GENRE_KEYWORDS[genre] ?? genre : "フィギュア おもちゃ");
    searchRakuten(q)
      .then((items) => {
        if (cancelled) return;
        setProgress({ checked: 0, total: items.length });
        return filterProfitable(items, (found, checked, total) => {
          if (cancelled) return;
          setProducts([...found]);
          setProgress({ checked, total });
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [keyword, genre]);

  const displayLabel = keyword || genre || "すべて";
  const isChecking = loading || progress.checked < progress.total;

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
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {isChecking && progress.total > 0 ? (
              <span>確認中 {progress.checked}/{progress.total}件…</span>
            ) : (
              <span className="font-semibold text-gray-600">{sorted.length}件</span>
            )}
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
          {sorted.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {/* 完了後0件 */}
        {!loading && products.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-gray-400 text-sm">利益が出る商品が見つかりませんでした</p>
            <Link href="/search" className="mt-4 inline-block text-indigo-600 text-sm font-medium">← 戻る</Link>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-300 leading-relaxed pb-4">
          ※ メルカリ売り切れ実績価格をもとに計算しています。実際の利益は状態・競合・送料などによって異なります。
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
