"use client";
import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SearchForm({ defaultKeyword = "" }: { defaultKeyword?: string }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [showFilters, setShowFilters] = useState(false);
  const [minProfit, setMinProfit] = useState(0);
  const [maxBuyPrice, setMaxBuyPrice] = useState(50000);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;
    const params = new URLSearchParams({ q: keyword, minProfit: String(minProfit), maxBuyPrice: String(maxBuyPrice) });
    router.push(`/results?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex gap-2 mb-2">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="商品名で検索（例: ポケモンカード BOX）"
            className="w-full pl-9 pr-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="px-3 py-3 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <SlidersHorizontal size={16} />
        </button>
        <button
          type="submit"
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          検索
        </button>
      </div>

      {showFilters && (
        <div className="mt-2 p-4 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">最低利益率（%）</label>
            <input type="number" value={minProfit} onChange={(e) => setMinProfit(Number(e.target.value))}
              min={0} max={500} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">仕入れ上限金額（円）</label>
            <input type="number" value={maxBuyPrice} onChange={(e) => setMaxBuyPrice(Number(e.target.value))}
              min={0} step={1000} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
      )}
    </form>
  );
}
