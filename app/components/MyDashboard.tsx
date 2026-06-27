"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Package, ArrowRight, ArrowDown, Settings, Store, Users, type LucideIcon } from "lucide-react";
import { fetchSoldIds } from "../lib/ebaySold";
import SaveProgressNudge from "./SaveProgressNudge";

interface MonthPoint { month: string; label: string; profit: number; sales: number; purchase: number; count: number }
interface Stats {
  soldCount: number;
  listedCount: number;
  boughtOnHandJpy: number;
  boughtOnHandCount: number;
  boughtTotalJpy: number;
  boughtTotalCount: number;
  listedPurchase: number;
  totalPurchase: number;
  totalSales: number;
  totalProfit: number;
  totalPoints: number;
  totalFees: number;
  avgProfit: number;
  bestProfit: number;
  monthly: MonthPoint[];
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

// 月別集計から「今月の利益」と「先月の利益」を取り出す（実カレンダー基準）。
// monthly に当月キーが無い＝今月まだ売れていない場合は出さない（0表示で誤解を招かないため）。
// 先月キーが無ければ diff は出さず当月だけ表示する。
function thisAndLastMonth(monthly: MonthPoint[]): { thisMonth: number; last: number | null } | null {
  if (!monthly.length) return null;
  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const curKey = ym(now);
  const cur = monthly.find((p) => p.month === curKey);
  if (!cur) return null; // 今月の売却がまだ無ければ非表示
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = ym(prev);
  const last = monthly.find((p) => p.month === prevKey);
  return { thisMonth: cur.profit, last: last ? last.profit : null };
}

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
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
      <p className="text-[13px] font-black text-gray-800 mb-1">お金の流れ</p>
      <p className="text-[11px] text-gray-400 mb-3">売れた商品の合計</p>

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
        <Legend color="bg-gray-400" label="仕入れ（支払った額）" value={`− ${yen(cost)}`} />
        <Legend color="bg-[#F0A0A0]" label="eBay手数料" value={`− ${yen(fee)}`} />
        <Legend color="bg-emerald-500" label="手数料を引いた残り" value={signedYen(grossTrue)} bold />
        {s.totalPoints > 0 && (
          <Legend color="bg-[#FF4466]" label="ポイント（おまけ）" value={`+ ${yen(s.totalPoints)}`} />
        )}
      </div>

      {/* 着地の利益（現金）。楽天ポイントは「( + ○○ポイント )」で別物として併記する。 */}
      <div className="mt-3 pt-3 border-t border-[#A98B5C]/25 flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-gray-700">あなたの利益（現金）</span>
        <div className="text-right">
          <span className={`text-xl font-black ${loss ? "text-[#2D323B]" : "text-emerald-600"}`}>
            {signedYen(s.totalProfit)}
          </span>
          {s.totalPoints > 0 && (
            <span className="block text-[11px] font-bold text-[#FF4466]">（ + {s.totalPoints.toLocaleString()}ポイント）</span>
          )}
        </div>
      </div>
      {loss && (
        <p className="mt-1 text-[11px] text-[#2D323B] leading-relaxed">
          <span className="whitespace-nowrap">いまは赤字。</span><wbr />
          <span className="whitespace-nowrap">仕入れ値より安く売れた</span><wbr />
          <span className="whitespace-nowrap">商品があるかも。</span><wbr />
          <span className="whitespace-nowrap">相場より高すぎない商品を</span><wbr />
          <span className="whitespace-nowrap">選ぶと改善。</span>
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

// 収支（仕入れ ↔ 売上）。仕入れ累計＝「仕入れた商品(used_bought)」の合計（送料込・/boughtと一致）。
// 売上＝自動出品で売れた金額。差引＝売上−手数料−仕入れ累計。旧モデル(楽天)のdealsは混ぜない。
function UsedFinancePanel({ s }: { s: Stats }) {
  const totalBuy = s.boughtTotalJpy; // 仕入れ商品の合計（送料込）＝/boughtと一致
  const buyCount = s.boughtTotalCount;
  const sales = s.totalSales; // 自動出品で売れた金額
  const netCash = sales - s.totalFees - totalBuy; // 差引（現金）。未売却在庫があるとマイナスになり得る
  if (totalBuy <= 0 && sales <= 0) return null;
  return (
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
      <p className="text-[13px] font-black text-gray-800 mb-1">収支（仕入れ ↔ 売上）</p>
      <p className="text-[11px] text-gray-400 mb-3">仕入れた商品（送料込）と、自動出品で売れた金額</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 whitespace-nowrap">仕入れ累計（{buyCount}件・送料込）</span>
          <span className="text-[13px] font-bold text-gray-700 tabular-nums">− {yen(totalBuy)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500 whitespace-nowrap">売上累計（{s.soldCount}件売れた）</span>
          <span className="text-[13px] font-bold text-[#0064D2] tabular-nums">+ {yen(sales)}</span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-[#A98B5C]/25 flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-gray-700 whitespace-nowrap">差引（現金）</span>
        <span className={`text-lg font-black tabular-nums ${netCash < 0 ? "text-[#2D323B]" : "text-emerald-600"}`}>
          {signedYen(netCash)}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
        <span className="whitespace-nowrap">※ 送料は各商品の設定値</span><wbr />
        <span className="whitespace-nowrap">（未設定は一律¥1,000）。</span><wbr />
        <span className="whitespace-nowrap">在庫が売れると差引が改善します。</span>
      </p>
    </div>
  );
}

// 月別→年別に集約（年単位の利益/売上/仕入れ/件数）。
interface Period { key: string; label: string; profit: number; sales: number; purchase: number; count: number }
function aggregateByYear(data: MonthPoint[]): Period[] {
  const m = new Map<string, Period>();
  for (const p of data) {
    const y = p.month.slice(0, 4);
    const cur = m.get(y) ?? { key: y, label: `${y}年`, profit: 0, sales: 0, purchase: 0, count: 0 };
    cur.profit += p.profit; cur.sales += p.sales; cur.purchase += p.purchase; cur.count += p.count;
    m.set(y, cur);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// 収支の推移（月別／年別の切替）。利益のバーチャート＋各期間の 仕入れ/売上/利益 を一覧で。CSS高さ比の軽量チャート。
function PeriodBreakdown({ data, soldCount }: { data: MonthPoint[]; soldCount: number }) {
  const [view, setView] = useState<"month" | "year">("month");
  const months: Period[] = data.map((p) => ({ key: p.month, label: p.label, profit: p.profit, sales: p.sales, purchase: p.purchase, count: p.count }));
  const years = aggregateByYear(data);
  const pts = (view === "month" ? months.slice(-12) : years);
  const max = Math.max(...pts.map((p) => Math.abs(p.profit)), 1); // 赤字も棒の長さに反映（絶対値基準）
  const charted = data.reduce((a, p) => a + p.count, 0);
  const unknown = Math.max(0, soldCount - charted);
  const rows = [...pts].reverse(); // 新しい順で一覧
  const tabCls = (on: boolean) => `h-7 px-3 rounded-full text-[11px] font-bold border ${on ? "bg-[#2D323B] text-white border-[#2D323B]" : "bg-white text-gray-500 border-[#A98B5C]/30"}`;
  return (
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-black text-gray-800">収支の推移</p>
        <div className="flex gap-1.5">
          <button onClick={() => setView("month")} className={tabCls(view === "month")}>月別</button>
          <button onClick={() => setView("year")} className={tabCls(view === "year")}>年別</button>
        </div>
      </div>
      {/* 利益バー */}
      <div className="flex items-end justify-between gap-1.5 overflow-x-auto">
        {pts.map((p) => {
          const loss = p.profit < 0;
          const h = Math.max(6, Math.round((Math.abs(p.profit) / max) * 100));
          return (
            <div key={p.key} className="flex-1 min-w-[28px] flex flex-col items-center gap-1">
              <span className={`text-[9px] font-bold tabular-nums whitespace-nowrap ${loss ? "text-red-500" : "text-gray-600"}`}>{yenShort(p.profit)}</span>
              <div className="w-full h-20 flex items-end">
                <div
                  className={`w-full rounded-t-md ${loss ? "bg-gradient-to-t from-red-400 to-red-300" : "bg-gradient-to-t from-[#2D323B] to-[#A98B5C]"}`}
                  style={{ height: `${h}%` }}
                  title={`${p.label}：${loss ? "赤字" : "利益"}${yen(p.profit)}（${p.count}件）`}
                />
              </div>
              <span className="text-[9px] text-gray-400 whitespace-nowrap">{p.label}</span>
            </div>
          );
        })}
      </div>
      {/* 期間別の 仕入れ/売上/利益 一覧 */}
      <div className="mt-3 pt-3 border-t border-[#A98B5C]/25 space-y-1.5">
        <div className="flex items-center text-[10px] text-gray-400 font-bold">
          <span className="w-14 shrink-0">{view === "month" ? "月" : "年"}</span>
          <span className="flex-1 text-right">仕入れ</span>
          <span className="flex-1 text-right">売上</span>
          <span className="flex-1 text-right">利益</span>
        </div>
        {rows.map((p) => (
          <div key={p.key} className="flex items-center text-[11px] tabular-nums">
            <span className="w-14 shrink-0 text-gray-600 font-bold">{p.label}</span>
            <span className="flex-1 text-right text-gray-500">{yen(p.purchase)}</span>
            <span className="flex-1 text-right text-[#0064D2] font-bold">{yen(p.sales)}</span>
            <span className={`flex-1 text-right font-black ${p.profit < 0 ? "text-red-500" : "text-emerald-600"}`}>{signedYen(p.profit)}</span>
          </div>
        ))}
      </div>
      {unknown > 0 && <p className="mt-2 text-[10px] text-gray-400">※ 売却日が不明な{unknown}件はグラフ対象外（累計には含む）</p>}
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

// マイページのハブ導線（チーム共有・各種設定へ）。仕入れ/出品中/お気に入りの一覧は「商品管理」(/manage)タブに集約済み。
function HubLinks() {
  // 設定は「輸出ラボアカウント設定(/settings)」と「eBayアカウント設定(/settings/ebay)」に分離。
  // 別物（自社サービスのアカウント vs 連携先eBayのアカウント）なので入口から2つに分ける。
  // ユーザー指示2026-06-27：出品管理・発送・受け取り・使い方ガイドの導線はマイページから外す。
  const items: { href: string; Icon: LucideIcon; label: string; full?: boolean }[] = [
    { href: "/team", Icon: Users, label: "チーム共有", full: true },
    { href: "/settings", Icon: Settings, label: "輸出ラボアカウント設定" },
    { href: "/settings/ebay", Icon: Store, label: "eBayアカウント設定" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ href, Icon, label, full }) => (
        <Link key={href} href={href}
          className={`flex items-center justify-center gap-1.5 min-h-[44px] px-2 py-1.5 rounded-xl bg-white border border-[#A98B5C]/25 shadow-sm text-[12px] font-bold text-gray-700 text-center leading-tight active:bg-gray-50 ${full ? "col-span-2" : ""}`}>
          <Icon size={15} className="text-gray-500 shrink-0" /> {label}
        </Link>
      ))}
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
        <div className="h-24 bg-white rounded-2xl border border-[#A98B5C]/25 animate-pulse" />
        <div className="h-40 bg-white rounded-2xl border border-[#A98B5C]/25 animate-pulse" />
        <div className="h-28 bg-white rounded-2xl border border-[#A98B5C]/25 animate-pulse" />
      </div>
    );
  }

  const s = stats;
  // 成果がある（出品済み）ときだけ、損失回避コピーでログインを促す。保存対象ゼロの新規には出さない。
  const nudge =
    s && s.listedCount > 0 ? (
      <SaveProgressNudge
        from="dashboard"
        message="💡 成績はこの端末だけに保存中。ログインすれば機種変・別端末でも“仕入れ・売上・利益”が消えません。"
      />
    ) : null;

  // 仕入れも出品も売上も無い＝完全に新規（「仕入れた」を押した人は下の収支へ進む）
  if (!s || (s.listedCount === 0 && s.boughtOnHandCount === 0 && s.totalSales === 0)) {
    return (
      <div className="space-y-3">
        {nudge}
        <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
          <Package size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-black text-gray-800 mb-1">まだ成績なし</p>
          <p className="text-[12px] text-gray-500 leading-relaxed">
            <span className="whitespace-nowrap">カタログで<b>「仕入れた」</b>を押す</span><wbr />
            <span className="whitespace-nowrap">→ <b>eBayへ出品</b></span><wbr />
            <span className="whitespace-nowrap">→ 売れると、ここに</span><wbr />
            <span className="whitespace-nowrap"><b>仕入れ・売上・差引</b>が出ます。</span>
          </p>
        </div>
        <HubLinks />
      </div>
    );
  }

  // まだ売れていない（「仕入れた」在庫 or 出品中はあり得る）＝収支パネルのみ（ユーザー指示2026-06-27でメッセージ/CTAは削除）。
  if (s.soldCount === 0) {
    return (
      <div className="space-y-3">
        {nudge}
        <UsedFinancePanel s={s} />
        <HubLinks />
      </div>
    );
  }

  // 売れた実績あり＝フル表示
  return (
    <div className="space-y-3">
      {nudge}

      {/* 収支（仕入れ↔売上）の総合管理を最上段に。下のヒーロー/お金の流れは「売れた分」の内訳。 */}
      <UsedFinancePanel s={s} />

      {/* 累計利益のヒーロー。赤字は符号だけに頼らず色＋「赤字」ラベル＋下向き矢印で黒字と明確に区別。 */}
      {(() => {
        const loss = s.totalProfit < 0;
        return (
          <div
            className={`rounded-2xl p-5 shadow-sm text-center border ${
              loss ? "bg-red-50 border-red-200" : "bg-white border-[#A98B5C]/25"
            }`}
          >
            <p className={`text-[12px] ${loss ? "text-red-500" : "text-gray-400"}`}>
              {loss && (
                <span className="inline-flex items-center gap-0.5 mr-1 font-bold text-red-600">
                  <ArrowDown size={12} aria-hidden="true" /> 赤字
                </span>
              )}
              稼いだ利益（累計・現金）
            </p>
            <p
              className={`mt-1 text-3xl font-black tracking-tight tabular-nums ${loss ? "text-red-600" : "text-[#2D323B]"}`}
              aria-label={`累計利益 ${loss ? "赤字 " : ""}${signedYen(s.totalProfit)}`}
            >
              {signedYen(s.totalProfit)}
            </p>
            {s.totalPoints > 0 && (
              <p className="mt-1 text-[13px] font-bold text-[#FF4466] whitespace-nowrap">（ + {s.totalPoints.toLocaleString()}ポイント）</p>
            )}
            <p className={`mt-1 text-[12px] ${loss ? "text-red-500" : "text-gray-500"}`}>
              {s.soldCount}件 売れました{s.totalProfit > 0 ? " 🎉" : ""}
            </p>
            {/* 今月の利益（先月比）。月別集計から当月/前月を拾えた時だけ出す。 */}
            {(() => {
              const m = thisAndLastMonth(s.monthly);
              if (!m) return null;
              const diff = m.last == null ? null : m.thisMonth - m.last;
              return (
                <p className="mt-2 text-[12px] text-gray-500">
                  <span className="whitespace-nowrap">今月の利益 <b className="text-gray-800 tabular-nums">{signedYen(m.thisMonth)}</b></span>
                  {diff != null && (
                    <span className={`ml-1 tabular-nums whitespace-nowrap ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      （先月比 {diff >= 0 ? "+" : "− "}
                      {"¥" + Math.round(Math.abs(diff)).toLocaleString("ja-JP")}）
                    </span>
                  )}
                </p>
              );
            })()}
          </div>
        );
      })()}

      <MoneyFlow s={s} />

      {s.monthly.length >= 1 && <PeriodBreakdown data={s.monthly} soldCount={s.soldCount} />}

      {/* 数値タイル。最高利益は正の取引が無い（全部赤字/初期値0）と ¥0 誤表示になるため、
          bestProfit>0 の時だけ「最高利益」を出し、それ以外は「ベスト記録待ち」のプレースホルダにする。 */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="売れた数" value={`${s.soldCount}件`} />
        <Tile label="1件あたり利益" value={signedYen(s.avgProfit)} sub="平均" />
        {s.bestProfit > 0 ? (
          <Tile label="最高利益" value={yen(s.bestProfit)} sub="1取引" />
        ) : (
          <Tile label="最高利益" value="—" sub="黒字待ち" />
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-gray-400 px-1">
        <span className="whitespace-nowrap">※ 利益（現金）＝ 売上</span><wbr />
        <span className="whitespace-nowrap">− eBay手数料(13.25%+¥47)</span><wbr />
        <span className="whitespace-nowrap">− 仕入れ値（為替 $1=¥155）。</span><wbr />
        <span className="whitespace-nowrap">ポイントは利益に含めず</span><wbr />
        <span className="whitespace-nowrap">「( + ○○ポイント )」で別表示</span><wbr />
        <span className="whitespace-nowrap">（おまけ扱い）。</span>
      </p>

      {/* 継続動機の主CTA：次の利益商品へ。平均利益が黒字の時だけ「1件あたり平均◯◯」を文言に織り込む。 */}
      <Link
        href="/catalog"
        aria-label="次の利益商品を見る"
        className="flex items-center justify-center gap-1.5 min-h-[48px] px-5 py-2.5 rounded-2xl bg-[#2D323B] text-white font-bold text-sm shadow-sm active:bg-[#1A1D23]"
      >
        <span>
          次の利益商品を見る
          {s.avgProfit > 0 && (
            <span className="block text-[11px] font-medium text-white/70">
              <span className="whitespace-nowrap">1件あたり平均 {yen(s.avgProfit)}</span> の利益
            </span>
          )}
        </span>
        <ArrowRight size={16} className="shrink-0" />
      </Link>

      <HubLinks />
    </div>
  );
}
