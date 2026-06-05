"use client";
import { UsageInfo } from "../types";
import { cn } from "../lib/utils";

export default function UsageMeter({ usage }: { usage: UsageInfo }) {
  const pct = (usage.usedToday / usage.limit) * 100;
  const remaining = usage.limit - usage.usedToday;

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm">
      <div className="flex flex-col gap-1 min-w-[140px]">
        <span className="text-gray-500 text-xs">今日の残り検索回数</span>
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-yellow-400" : "bg-green-500")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className={cn("font-semibold", remaining === 0 ? "text-red-500" : "text-gray-800")}>
        {remaining} / {usage.limit}
      </span>
      {usage.plan === "free" && (
        <a href="/pricing" className="ml-auto text-xs text-indigo-600 hover:underline whitespace-nowrap">
          アップグレード →
        </a>
      )}
    </div>
  );
}
