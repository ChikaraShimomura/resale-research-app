import { kvReadOnly } from "./kv";
import {
  FUNNEL_EVENTS,
  FUNNEL_LABELS,
  type FunnelEvent,
  jstDate,
  evcKey,
  evuKey,
} from "./funnel";

// 行動ログ（evc/evu）の日次ファネルを集計し、メール用のHTMLを組み立てる。
// 読み取りのみのため kvReadOnly を使う（万一漏れてもデータを書き換えられない）。

export interface StepStat {
  event: FunnelEvent;
  label: string;
  count: number; // evc（延べ回数）
  unique: number; // evu（ユニーク端末数）
}

export interface DailyReport {
  date: string; // 対象日（JST, YYYY-MM-DD）
  prevDate: string;
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

// 1日分のステップ統計を取得。
async function fetchDay(date: string): Promise<StepStat[]> {
  const counts = (await kvReadOnly
    .mget<(number | null)[]>(...FUNNEL_EVENTS.map((e) => evcKey(date, e)))
    .catch(() => [])) as (number | null)[];
  const uniques = await Promise.all(
    FUNNEL_EVENTS.map((e) => kvReadOnly.scard(evuKey(date, e)).catch(() => 0))
  );
  return FUNNEL_EVENTS.map((e, i) => ({
    event: e,
    label: FUNNEL_LABELS[e],
    count: Number(counts[i] ?? 0),
    unique: Number(uniques[i] ?? 0),
  }));
}

// 直近 days 日（offset 起点から遡る）の延べ回数合計を、イベントごとに集計。
async function fetchTotals(startOffset: number, days: number): Promise<Record<string, number>> {
  const dates = Array.from({ length: days }, (_, i) => jstDate(startOffset + i));
  const perDay = await Promise.all(
    dates.map(
      (d) =>
        kvReadOnly
          .mget<(number | null)[]>(...FUNNEL_EVENTS.map((e) => evcKey(d, e)))
          .catch(() => []) as Promise<(number | null)[]>
    )
  );
  const totals: Record<string, number> = {};
  FUNNEL_EVENTS.forEach((e, i) => {
    totals[e] = perDay.reduce((s, day) => s + Number(day?.[i] ?? 0), 0);
  });
  return totals;
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

// 前日比の矢印つき差分。
function delta(now: number, prev: number): string {
  const d = now - prev;
  if (d > 0) return `<span style="color:#16a34a">▲${d}</span>`;
  if (d < 0) return `<span style="color:#BF0000">▼${-d}</span>`;
  return `<span style="color:#9ca3af">±0</span>`;
}

// 対象日(JST)の「今日から見たオフセット日数」。?date= 指定時の7日計の窓を対象日基準に揃える。
function jstOffsetOf(date: string): number {
  const ms = Date.parse(`${jstDate(0)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/**
 * 対象日（既定: 昨日JST）の日次ファネルレポートを組み立てる。
 */
export async function buildDailyReport(targetDate?: string): Promise<DailyReport> {
  const date = targetDate || jstDate(1); // 既定は「昨日」（JSTで確定済みの1日）
  const prevDate = jstDate(targetDate ? 0 : 2); // 比較は対象日の前日
  // 対象日が指定された場合の前日は文字列から算出するのが厳密だが、
  // 既定運用（昨日）では jstDate(2) が前日。指定時は前日比を省略する。
  const [steps, prevSteps, week] = await Promise.all([
    fetchDay(date),
    targetDate ? Promise.resolve(null) : fetchDay(prevDate),
    fetchTotals(targetDate ? jstOffsetOf(targetDate) : 1, 7),
  ]);

  const byEvent = (arr: StepStat[] | null, ev: FunnelEvent): StepStat | undefined =>
    arr?.find((s) => s.event === ev);
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
      const prev = prevSteps ? byEvent(prevSteps, s.event) : undefined;
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
        <td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;text-align:right;color:#6b7280">${week[s.event] ?? 0}</td>
      </tr>`;
    })
    .join("");

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto">
    <h2 style="color:#BF0000;font-size:18px;margin:0 0 4px">📊 行動ログ日次レポート</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px">${withWeekday(date)}（日本時間）</p>

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
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">前日比</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">端末数</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">直前比</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">訪問比</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">7日計</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="font-size:11px;color:#9ca3af;margin:14px 0 0;line-height:1.6">
      ・「回数」＝延べイベント数、「端末数」＝ユニーク端末（cookie）数。<br>
      ・「直前比」「訪問比」はユニーク端末ベースの継続率。<br>
      ・「前日比」は回数の増減。集計は日本時間・100日で自動失効。
    </p>
  </div>`;

  const text = [
    `行動ログ日次レポート ${withWeekday(date)}`,
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
    date,
    prevDate,
    subject: `📊 行動ログ ${date}｜訪問${visits}・出品${listed}・売却${sold}`,
    html,
    text,
    summary: { visits, listed, sold, bottleneck },
  };
}
