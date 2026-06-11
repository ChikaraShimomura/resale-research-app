"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";

export default function SearchForm({ defaultKeyword = "" }: { defaultKeyword?: string }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(defaultKeyword);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;
    router.push(`/results?q=${encodeURIComponent(keyword)}`);
  }

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
          className="px-5 py-2.5 bg-[#FF6600] hover:bg-[#E05A00] active:bg-[#CC4D00] active:scale-[0.98] text-white rounded-md text-sm font-bold transition-all shrink-0"
        >
          検索
        </button>
      </div>
    </form>
  );
}
