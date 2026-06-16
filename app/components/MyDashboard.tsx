"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Package, Truck, Wallet, ArrowRight } from "lucide-react";
import { fetchSoldIds } from "../lib/ebaySold";
import SaveProgressNudge from "./SaveProgressNudge";
import ActiveListings from "./ActiveListings";

interface Rank { name: string; icon: string; min: number }
interface MonthPoint { month: string; label: string; profit: number; sales: number; purchase: number; count: number }
interface Stats {
  soldCount: number;
  listedCount: number;
  listedPurchase: number;
  totalPurchase: number;
  totalSales: number;
  totalProfit: number;
  totalPoints: number;
  totalFees: number;
  avgProfit: number;
  bestProfit: number;
  monthly: MonthPoint[];
  rank: Rank;
  nextRank: Rank | null;
  toNext: number;
}

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
// 符号は ¥ の前に出す（−¥3,000 のように・UI全体で統一）
const signedYen = (n: number) => (n < 0 ? "− " : "") + "¥" + Math.round(Math.abs(n)).toLocaleString("ja-JP");
// グラフの値ラベルは短く（¥12,300 → ¥12.3k）。負値も符号を前に（−¥10k）。
const yenShort = (n: number) => {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  return a >= 10000
    ? sign + "¥" + (Math.round(a / 100) / 10).toLocaleString("ja-JP") + "k"
    : sign + "¥" + Math.round(a).toLocaleString("ja-JP");
};

// 売上の内訳バー（仕入れ・手数料・利益）。「いくら仕入れて・いくらで売れて・利益がいくらか」を一目で。
function MoneyFlow({ s }: { s: Stats }) {
  const sales = s.totalSales;
  if (sales <= 0) return null;
  const cost = s.totalPurchase;
  const fee = s.totalFees;
  const grossTrue = sales - cost - fee; // 手数料まで引いた残り（ポイント除く・赤字なら負）
  const grossBar = Math.max(0, grossTrue); // バー幅にだけクランプ（表示金額はクランプしない）
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / sales) * 100))}%`;
  const loss = s.totalProfit < 0;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <p className="text-[13px] font-black text-gray-800 mb-1">お金の流れ</p>
      <p className="text-[11px] text-gray-400 mb-3">売れた商品の合計です</p>

      {/* 売上＝棒全体。内訳を色分け */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-gray-500">売上合計</span>
        <span className="text-[13px] font-black text-[#0064D2]">{yen(sales)}</span>
      </div>
      <div className="flex h-7 w-full rounded-lg overflow-hidden bg-gray-100">
        <div style={{ width: w(cost) }} className="bg-gray-400" title="仕入れ" />
        <div style={{ width: w(fee) }} className="bg-[#F0A0A0]" title="eBay手数料" />
        <div style={{ width: w(grossBar) }} className="bg-emerald-500" title="手数料を引いた残り" />
      </div>

      {/* 凡例＋金額（「利益」という語は最後の着地行だけに使い、混同を避ける） */}
      <div className="mt-3 space-y-1.5">
        <Legend color="bg-gray-400" label="仕入れ（楽天で払った額）" value={`− ${yen(cost)}`} />
        <Legend color="bg-[#F0A0A0]" label="eBay手数料" value={`− ${yen(fee)}`} />
        <Legend color="bg-emerald-500" label="手数料を引いた残り" value={signedYen(grossTrue)} bold />
        {s.totalPoints > 0 && (
          <Legend color="bg-[#FF4466]" label="楽天ポイント（おまけ）" value={`+ ${yen(s.totalPoints)}`} />
        )}
      </div>

      {/* 着地の利益（このカードで「利益」を名乗るのはここだけ） */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[12px] font-bold text-gray-700">
          あなたの利益{s.totalPoints > 0 ? "（ポイント込み）" : ""}
        </span>
        <span className={`text-xl font-black ${loss ? "text-[#BF0000]" : "text-emerald-600"}`}>
          {signedYen(s.totalProfit)}
        </span>
      </div>
      {loss && (
        <p className="mt-1 text-[11px] text-[#BF0000] leading-relaxed">
          いまは赤字です。仕入れ値より安く売れた商品があるかもしれません。相場より高すぎない商品を選ぶと改善します。
        </p>
      )}
    </div>
  );
}

function Legend({ color, label, value, bold }: { color: string; label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${color}`} />
      <span className="text-[11px] text-gray-500 flex-1 min-w-0 truncate">{label}</span>
      <span className={`text-[12px] tabular-nums ${bold ? "font-black text-emerald-600" : "font-bold text-gray-700"}`}>{value}</span>
    </div>
  );
}

// 月別の利益推移（直近6ヶ月）。CSS の高さ比で描く軽量バーチャート。
function MonthlyChart({ data, soldCount }: { data: MonthPoint[]; soldCount: number }) {
  const pts = data.slice(-6);
  const max = Math.max(...pts.map((p) => p.profit), 1);
  const charted = data.reduce((a, p) => a + p.count, 0); // 月別に集計できた件数
  const unknown = Math.max(0, soldCount - charted); // 売却日が不明で月別に出せない件数
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <p className="text-[13px] font-black text-gray-800 mb-3">月ごとの利益</p>
      <div className="flex items-end justify-between gap-2">
        {pts.map((p) => {
          const h = Math.max(6, Math.round((Math.max(0, p.profit) / max) * 100));
          return (
            <div key={p.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[9px] font-bold text-gray-600 tabular-nums">{yenShort(p.profit)}</span>
              <div className="w-full h-20 flex items-end">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-[#BF0000] to-[#FF4466]"
                  style={{ height: `${h}%` }}
                  title={`${p.label}：${yen(p.profit)}（${p.count}件）`}
                />
              </div>
              <span className="text-[10px] text-gray-400">{p.label}</span>
            </div>
          );
        })}
      </div>
      {unknown > 0 && (
        <p className="mt-2 text-[10px] text-gray-400">※ 売却日が不明な{unknown}件はこのグラフに含みません（累計には含みます）</p>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#F5F7FA] rounded-xl px-2 py-3 text-center">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-black text-gray-800 tabular-nums">{value}</p>
      {sub && <p className="text-[9px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// 称号は「マイページ」だけに置く（控えめに1ブロック）。
function RankBlock({ s }: { s: Stats }) {
  const pct = s.nextRank
    ? Math.max(2, Math.min(100, Math.round((s.totalProfit / s.nextRank.min) * 100)))
    : 100;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">{s.rank.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-gray-400">いまの称号</p>
          <p className="text-sm font-black text-gray-800">{s.rank.name}</p>
        </div>
        {s.nextRank && (
          <span className="text-[11px] text-gray-400 shrink-0">
            次は {s.nextRank.icon} {s.nextRank.name}
          </span>
        )}
      </div>
      {s.nextRank && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#BF0000] to-[#FF4466]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">あと {yen(s.toNext)} で昇格</p>
        </div>
      )}
    </div>
  );
}

// 売れた後の導線（発送→受け取り）。
function AfterSaleLinks() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Link href="/guide#step-4" className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-white border border-gray-100 shadow-sm text-[12px] font-bold text-gray-700 active:bg-gray-50">
        <Truck size={15} className="text-gray-500" /> 発送のしかた
      </Link>
      <Link href="/guide/payoneer-withdraw" className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-white border border-gray-100 shadow-sm text-[12px] font-bold text-gray-700 active:bg-gray-50">
        <Wallet size={15} className="text-gray-500" /> 売上の受け取り方
      </Link>
    </div>
  );
}

export default function MyDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 集計の取得（出品中リストでの手動調整後にも呼んで最新化する）。
  const loadStats = useCallback(async () => {
    try {
      const j = await fetch("/api/ebay/stats", { cache: "no-store" }).then((r) => r.json());
      if (j.ok) setStats(j.stats);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await fetchSoldIds(); // 売却を同期して最新化
      } catch {
        /* noop */
      }
      await loadStats();
      setLoaded(true);
    })();
  }, [loadStats]);

  if (!loaded) {
    return (
      <div className="space-y-3">
        <div className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        <div className="h-40 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        <div className="h-28 bg-white rounded-2xl border border-gray-100 animate-pulse" />
      </div>
    );
  }

  const s = stats;
  // 成果がある（出品済み）ときだけ、損失回避コピーでログインを促す。保存対象ゼロの新規には出さない。
  const nudge =
    s && s.listedCount > 0 ? (
      <SaveProgressNudge
        from="dashboard"
        message="💡 いまの成績はこの端末だけに保存中。ログインすれば、機種変や別の端末でも“育てた利益・称号”が消えません。"
      />
    ) : null;

  // まだ1件も出品していない（新規）
  if (!s || s.listedCount === 0) {
    return (
      <div className="space-y-3">
        {nudge}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center shadow-sm">
          <Package size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-black text-gray-800 mb-1">まだ成績がありません</p>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-5">
            利益商品を選んで最初の1品を出品すると、<br />
            ここに<b>仕入れ・売上・利益</b>が図で出てきます。
          </p>
          <Link href="/search" className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000]">
            利益商品を見る <ArrowRight size={16} />
          </Link>
          <Link href="/guide" className="block mt-3 text-[12px] font-bold text-[#BF0000] underline underline-offset-2">
            画像つきの始め方ガイドを見る →
          </Link>
        </div>
      </div>
    );
  }

  // 出品済みだがまだ売れていない
  if (s.soldCount === 0) {
    return (
      <div className="space-y-3">
        {nudge}
        <RankBlock s={s} />
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-start gap-3">
          <Package size={22} className="text-gray-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-gray-800">出品中です（{s.listedCount}件）</p>
            {s.listedPurchase > 0 && (
              <p className="text-[12px] text-gray-600 mt-0.5">
                仕入れ合計（楽天で払った額）<b className="text-gray-800">{yen(s.listedPurchase)}</b>
              </p>
            )}
            <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
              売れると、ここに<b>仕入れ・売上・利益</b>が図で出ます。まだ売れていないだけなので、出品しただけで成績が下がることはありません。
            </p>
          </div>
        </div>
        <ActiveListings onChanged={loadStats} />
        <AfterSaleLinks />
      </div>
    );
  }

  // 売れた実績あり＝フル表示
  return (
    <div className="space-y-3">
      {nudge}

      {/* 累計利益のヒーロー */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm text-center">
        <p className="text-[12px] text-gray-400">このサイトで稼いだ利益（累計）</p>
        <p className="mt-1 text-4xl font-black text-[#BF0000] tracking-tight">{signedYen(s.totalProfit)}</p>
        <p className="mt-1 text-[12px] text-gray-500">{s.soldCount}件 売れました{s.totalProfit > 0 ? " 🎉" : ""}</p>
      </div>

      <RankBlock s={s} />

      <MoneyFlow s={s} />

      {s.monthly.length >= 2 && <MonthlyChart data={s.monthly} soldCount={s.soldCount} />}

      {/* 数値タイル */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="売れた数" value={`${s.soldCount}件`} />
        <Tile label="1件あたり利益" value={signedYen(s.avgProfit)} sub="平均" />
        <Tile label="最高利益" value={yen(s.bestProfit)} sub="1取引" />
      </div>

      <p className="text-[10px] leading-relaxed text-gray-400 px-1">
        ※ 利益は eBay手数料(13.25%+¥47)・仕入れ値・基本ポイントから計算（為替 $1=¥155）。0と5のつく日など実際のポイントはこれより多い場合があります。
      </p>

      <ActiveListings onChanged={loadStats} />

      <AfterSaleLinks />
    </div>
  );
}
