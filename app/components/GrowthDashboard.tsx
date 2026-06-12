"use client";
import { useEffect, useState } from "react";
import { fetchSoldIds } from "../lib/ebaySold";

interface Rank { name: string; icon: string; min: number }
interface Stats {
  soldCount: number;
  listedCount: number;
  totalPurchase: number;
  totalSales: number;
  totalProfit: number;
  totalPoints: number;
  rank: Rank;
  nextRank: Rank | null;
  toNext: number;
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F5F7FA] rounded-xl px-2 py-2 text-center">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className="text-[13px] font-black text-gray-800">{value}</p>
    </div>
  );
}

// ホーム上部の「育てるダッシュボード」。出品実績がある端末にだけ表示する。
export default function GrowthDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await fetchSoldIds(); // 売却を同期して取引(売値)を最新化
      } catch {
        /* noop */
      }
      try {
        const j = await fetch("/api/ebay/stats", { cache: "no-store" }).then((r) => r.json());
        if (j.ok) setStats(j.stats);
      } catch {
        /* noop */
      }
      setLoaded(true);
    })();
  }, []);

  // 読込中・未出品(新規訪問者)は何も出さない
  if (!loaded || !stats || stats.listedCount === 0) return null;

  // 出品済みだがまだ売れていない＝応援表示
  if (stats.soldCount === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">{stats.rank.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-black text-gray-800">{stats.rank.name}</p>
            <p className="text-[11px] text-gray-500">出品中。売れると利益と称号が育ちます🌱</p>
          </div>
        </div>
      </div>
    );
  }

  const pct = stats.nextRank
    ? Math.min(100, Math.round((stats.totalProfit / stats.nextRank.min) * 100))
    : 100;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl" aria-hidden="true">{stats.rank.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-gray-400">あなたの称号</p>
            <p className="text-base font-black text-gray-800">{stats.rank.name}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-gray-400">累計利益</p>
            <p className="text-lg font-black text-[#BF0000]">{yen(stats.totalProfit)}</p>
          </div>
        </div>

        {stats.nextRank && (
          <div className="mb-3">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#BF0000] to-[#FF4466]" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              次の称号「{stats.nextRank.icon} {stats.nextRank.name}」まで あと {yen(stats.toNext)}
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="売れた数" value={`${stats.soldCount}件`} />
          <Stat label="売上合計" value={yen(stats.totalSales)} />
          <Stat label="仕入れ合計" value={yen(stats.totalPurchase)} />
        </div>

        <div className="mt-2 bg-[#FFF0F4] rounded-xl px-3 py-2 flex items-center gap-2">
          <span className="inline-flex w-4 h-4 bg-[#FF4466] rounded-full items-center justify-center text-white font-black text-[8px] shrink-0">R</span>
          <span className="text-[12px] font-bold text-[#FF4466]">基本ポイント {stats.totalPoints.toLocaleString()}pt</span>
          <span className="text-[10px] text-gray-400 ml-auto">※キャンペーン抜き。実はもっと得してます</span>
        </div>
      </div>
    </div>
  );
}
