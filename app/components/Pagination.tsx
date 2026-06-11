"use client";

export const PAGE_SIZE = 30;

// 現在ページ中心に、先頭・末尾・前後を表示（離れていれば … を挟む）
function pageWindow(page: number, pageCount: number): (number | "...")[] {
  const around = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const out: (number | "...")[] = [];
  let prev = 0;
  for (let n = 1; n <= pageCount; n++) {
    if (!around.has(n) || n < 1) continue;
    if (n - prev > 1) out.push("...");
    out.push(n);
    prev = n;
  }
  return out;
}

export default function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;

  const go = (p: number) => {
    if (p < 1 || p > pageCount || p === page) return;
    onChange(p);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center flex-wrap gap-1.5 px-3 py-5">
      <button onClick={() => go(page - 1)} disabled={page <= 1}
        className="inline-flex items-center min-h-[40px] px-3 rounded-lg border border-gray-200 bg-white text-xs font-bold text-gray-600 disabled:opacity-40 active:bg-gray-50">
        ‹ 前へ
      </button>
      {pageWindow(page, pageCount).map((n, i) =>
        n === "..." ? (
          <span key={`e${i}`} className="px-1 text-gray-400 text-xs">…</span>
        ) : (
          <button key={n} onClick={() => go(n)} aria-current={n === page ? "page" : undefined}
            className={`inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg border text-xs font-bold ${
              n === page
                ? "bg-[#BF0000] border-[#BF0000] text-white"
                : "bg-white border-gray-200 text-gray-600 active:bg-gray-50"
            }`}>
            {n}
          </button>
        )
      )}
      <button onClick={() => go(page + 1)} disabled={page >= pageCount}
        className="inline-flex items-center min-h-[40px] px-3 rounded-lg border border-gray-200 bg-white text-xs font-bold text-gray-600 disabled:opacity-40 active:bg-gray-50">
        次へ ›
      </button>
    </nav>
  );
}
