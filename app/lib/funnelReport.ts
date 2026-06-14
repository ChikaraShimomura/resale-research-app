import { kvReadOnly } from "./kv";
import {
  FUNNEL_EVENTS,
  FUNNEL_LABELS,
  type FunnelEvent,
  jstDate,
  evcKey,
  evuKey,
} from "./funnel";

// 行動ログ（evc/evu）の「週次」ファネルを集計し、メール用のHTMLを組み立てる。
// 読み取りのみのため kvReadOnly を使う（万一漏れてもデータを書き換えられない）。
//
// 週次の数え方:
//   ・回数(evc)＝対象7日分の単純合計。
//   ・端末数(evu)＝7日分の集合の「和集合の濃度」。同じ端末が複数日来ても1としてユニークに数える
//     （日次SCARDの単純合計だと重複端末を二重計上してしまうため SUNION で取る）。

export interface StepStat {
  event: FunnelEvent;
  label: string;
  count: number; // evc（延べ回数・期間合計）
  unique: number; // evu（ユニーク端末数・期間の和集合）
}

export interface WeeklyReport {
  periodStart: string; // 対象期間の開始日（古い方, JST YYYY-MM-DD）
  periodEnd: string; // 対象期間の最終日（新しい方, JST YYYY-MM-DD）
  subject: string;
  html: string;
  text: string;
  // 機械可読サマリ（APIレスポンス用）
  summary: {
    visits: number;
    listed: number;
    sold: number;
    bottleneck: string | null;
  };
}

// 指定した日付群の「回数合計」と「ユニーク端末数（和集合）」をイベント別に集計。
async function fetchRangeStats(dates: string[]): Promise<StepStat[]> {
  // 回数: 全 (event × date) のキーを一括 mget して、イベントごとに合算。
  const countKeys = FUNNEL_EVENTS.flatMap((e) => dates.map((d) => evcKey(d, e)));
  const counts = (await kvReadOnly
    .mget<(number | null)[]>(...countKeys)
    .catch(() => [])) as (number | null)[];

  // ユニーク端末: イベントごとに対象日の evu 集合を和集合し、その濃度を取る。
  // 1日だけなら SCARD、複数日なら SUNION（重複端末を二重計上しない）。
  const uniques = await Promise.all(
    FUNNEL_EVENTS.map((e) => {
      const keys = dates.map((d) => evuKey(d, e));
      // sunion は [string, ...string[]]（1個以上）を要求するため、先頭を明示して残りを展開。
      return keys.length === 1
        ? kvReadOnly.scard(keys[0]).catch(() => 0)
        : kvReadOnly
            .sunion(keys[0], ...keys.slice(1))
            .then((arr) => (Array.isArray(arr) ? arr.length : 0))
            .catch(() => 0);
    })
  );

  return FUNNEL_EVENTS.map((e, i) => {
    const base = i * dates.length;
    const count = dates.reduce((s, _d, j) => s + Number(counts[base + j] ?? 0), 0);
    return { event: e, label: FUNNEL_LABELS[e], count, unique: Number(uniques[i] ?? 0) };
  });
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
function withWeekday(date: string): string {
  // date は JST のカレンダー日付。曜日のみ算出（タイムゾーンずれの影響なし）。
  const wd = WD[new Date(`${date}T00:00:00+09:00`).getDay()] ?? "";
  return `${date}（${wd}）`;
}

function pct(a: number, b: number): string {
  if (b <= 0) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

// 前週比の矢印つき差分。
function delta(now: number, prev: number): string {
  const d = now - prev;
  if (d > 0) return `<span style="color:#16a34a">▲${d}</span>`;
  if (d < 0) return `<span style="color:#BF0000">▼${-d}</span>`;
  return `<span style="color:#9ca3af">±0</span>`;
}

// 対象日(JST)の「今日から見たオフセット日数」。?date= 指定時の窓を対象日基準に揃える。
function jstOffsetOf(date: string): number {
  const ms = Date.parse(`${jstDate(0)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/**
 * 週次ファネルレポートを組み立てる。
 * 既定では「昨日(JST)を最終日とする直近7日」を対象とし、前週(その前の7日)と比較する。
 * endDate を指定すると、その日を最終日とする7日窓を対象にする（手動確認用）。
 */
export async function buildWeeklyReport(endDate?: string): Promise<WeeklyReport> {
  // 窓の最終日オフセット（既定は昨日=1）。endDate 指定時はその日を最終日に。
  const endOffset = endDate ? Math.max(0, jstOffsetOf(endDate)) : 1;
  const thisDates = Array.from({ length: 7 }, (_, i) => jstDate(endOffset + i)); // [最終日 .. 6日前]
  const prevDates = Array.from({ length: 7 }, (_, i) => jstDate(endOffset + 7 + i)); // さらに前の7日
  const periodEnd = thisDates[0]; // 新しい方
  const periodStart = thisDates[thisDates.length - 1]; // 古い方

  const [steps, prevSteps] = await Promise.all([
    fetchRangeStats(thisDates),
    fetchRangeStats(prevDates),
  ]);

  const byEvent = (arr: StepStat[], ev: FunnelEvent): StepStat | undefined =>
    arr.find((s) => s.event === ev);
  const visits = byEvent(steps, "visit")?.unique ?? 0;
  const listed = byEvent(steps, "listed")?.count ?? 0;
  const sold = byEvent(steps, "sold")?.count ?? 0;

  // 最大の離脱ポイント＝直前ステップからの継続率が最も低い箇所（母数がある所のみ）。
  let bottleneck: string | null = null;
  let worstRate = Infinity;
  for (let i = 1; i < steps.length; i++) {
    const prevU = steps[i - 1].unique;
    const curU = steps[i].unique;
    if (prevU >= 3 && curU / prevU < worstRate) {
      worstRate = curU / prevU;
      bottleneck = `${steps[i - 1].label}→${steps[i].label}（継続 ${pct(curU, prevU)}）`;
    }
  }

  // ── テーブル行 ──
  const rows = steps
    .map((s, i) => {
      const prev = byEvent(prevSteps, s.event);
      const stepConv = i === 0 ? "—" : pct(s.unique, steps[i - 1].unique); // 直前ステップ比（ユニーク）
      const fromTop = pct(s.unique, steps[0].unique); // 訪問比（ユニーク）
      const deltaCell = prev ? delta(s.count, prev.count) : "—";
      const zebra = i % 2 === 0 ? "#ffffff" : "#fafafa";
      return `
      <tr style="background:${zebra}">
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111">${i + 1}. ${s.label}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;color:#111"><b>${s.count}</b></td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right">${deltaCell}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;color:#111">${s.unique}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right;color:#6b7280">${stepConv}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right;color:#6b7280">${fromTop}</td>
      </tr>`;
    })
    .join("");

  const periodLabel = `${withWeekday(periodStart)} 〜 ${withWeekday(periodEnd)}`;

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto">
    <h2 style="color:#BF0000;font-size:18px;margin:0 0 4px">📊 行動ログ週次レポート</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px">${periodLabel}（日本時間・直近7日間）</p>

    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 16px">
      <tr>
        <td style="width:33%;background:#FFF5F5;border:1px solid #FEE2E2;border-radius:10px;padding:10px 12px;vertical-align:top">
          <div style="font-size:11px;color:#991b1b">訪問（端末）</div>
          <div style="font-size:22px;font-weight:800;color:#BF0000">${visits}</div>
        </td>
        <td style="width:33%;background:#F0FDF4;border:1px solid #DCFCE7;border-radius:10px;padding:10px 12px;vertical-align:top">
          <div style="font-size:11px;color:#166534">出品完了</div>
          <div style="font-size:22px;font-weight:800;color:#16a34a">${listed}</div>
        </td>
        <td style="width:33%;background:#EFF6FF;border:1px solid #DBEAFE;border-radius:10px;padding:10px 12px;vertical-align:top">
          <div style="font-size:11px;color:#1e40af">売れた</div>
          <div style="font-size:22px;font-weight:800;color:#1d4ed8">${sold}</div>
        </td>
      </tr>
    </table>

    ${
      bottleneck
        ? `<p style="font-size:13px;background:#FFFBEB;border:1px solid #FEF3C7;border-radius:8px;padding:10px 12px;margin:0 0 16px;color:#92400e">⚠️ 最大の離脱ポイント：<b>${bottleneck}</b></p>`
        : ""
    }

    <table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#F9FAFB">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">ステップ</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">回数</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">前週比</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">端末数</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">直前比</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">訪問比</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="font-size:11px;color:#9ca3af;margin:14px 0 0;line-height:1.6">
      ・「回数」＝直近7日の延べイベント数、「端末数」＝7日のユニーク端末（cookie・和集合）数。<br>
      ・「直前比」「訪問比」はユニーク端末ベースの継続率。<br>
      ・「前週比」は回数の前週との増減。集計は日本時間・100日で自動失効。
    </p>
  </div>`;

  const text = [
    `行動ログ週次レポート ${periodLabel}`,
    `訪問(端末) ${visits} / 出品完了 ${listed} / 売れた ${sold}`,
    bottleneck ? `最大の離脱: ${bottleneck}` : "",
    "",
    ...steps.map(
      (s, i) =>
        `${i + 1}. ${s.label}: ${s.count}回 / ${s.unique}端末` +
        (i === 0 ? "" : ` (直前比 ${pct(s.unique, steps[i - 1].unique)})`)
    ),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    periodStart,
    periodEnd,
    subject: `📊 行動ログ週次 ${periodStart}〜${periodEnd}｜訪問${visits}・出品${listed}・売却${sold}`,
    html,
    text,
    summary: { visits, listed, sold, bottleneck },
  };
}
