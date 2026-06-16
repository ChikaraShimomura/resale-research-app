"use client";
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { logEvent } from "../lib/analytics";

export default function SearchForm({ defaultKeyword = "" }: { defaultKeyword?: string }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(defaultKeyword);
  // 2回目以降の検索でURLのキーワード変化に追従させる（初期化のみだと同期されないバグ対策）
  useEffect(() => {
    setKeyword(defaultKeyword);
  }, [defaultKeyword]);

  function go(q: string) {
    if (!q.trim()) return;
    logEvent("search"); // 検索実行（ファネル計測）
    router.push(`/results?q=${encodeURIComponent(q)}`);
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    go(keyword);
  }

  // 「何を検索すればいいか分からない」を防ぐ人気ジャンルのサジェスト（タップで検索）
  const GENRES = ["ポケモンカード", "レゴ", "ガンプラ", "フィギュア", "腕時計"];

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex gap-1.5">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="商品名を入力"
            aria-label="商品名で検索"
            className="w-full pl-9 pr-3 py-2.5 bg-white rounded-md text-sm focus:outline-none border-0 ring-0"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1 px-4 py-2.5 bg-white hover:bg-gray-50 active:bg-gray-100 active:scale-[0.98] text-[#BF0000] rounded-md text-sm font-black transition-all shrink-0"
        >
          <Search size={15} strokeWidth={2.5} />
          検索
        </button>
      </div>
      {/* 人気ジャンルのサジェスト（タップで検索）。検索しなくても下にスクロールで一覧も見られる。 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {GENRES.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => go(g)}
            className="text-[11px] font-bold text-white/95 bg-white/15 rounded-full px-2.5 py-1 active:bg-white/25"
          >
            {g}
          </button>
        ))}
      </div>
    </form>
  );
}
