// 行動ログ（離脱分析用ファネル）の共通定義。
// /api/track が日次でカウントし、/api/report/daily が集計してメール送信する。
// 双方が同じキー設計を参照できるよう、ここに一元化している（DRY）。
//
// キー設計:
//   evc:{JST日付}:{event} = 回数（INCR / INCRBY）
//   evu:{JST日付}:{event} = ユニーク端末数（SADD した rr_did の集合 → SCARD で件数）
// いずれも 100 日で自動失効。個人を特定する生ログは保存しない（端末cookieのみ）。

// ファネルの順序＝そのままユーザーの導線。タイポ・濫用での無限キー生成を防ぐ allowlist も兼ねる。
export const FUNNEL_EVENTS = [
  "visit",
  "search",
  "results_view",
  "product_view",
  "rakuten_buy",
  "listing_open",
  "listed",
  "sold",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

// レポート表示用の日本語ラベル。
export const FUNNEL_LABELS: Record<FunnelEvent, string> = {
  visit: "訪問（トップ）",
  search: "検索した",
  results_view: "検索結果を見た",
  product_view: "商品の詳細を見た",
  rakuten_buy: "楽天で仕入れる",
  listing_open: "出品をはじめた",
  listed: "出品が完了",
  sold: "売れた",
};

// 集計キーの有効期間（100 日）。
export const FUNNEL_TTL = 100 * 24 * 60 * 60;

// 集計の日付キーは日本時間（ユーザーは日本在住・レポートもJST基準）。
// offsetDays=1 で「昨日」、=7 で「7日前」のJST日付を返す。
export function jstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
}

export const evcKey = (date: string, event: string): string => `evc:${date}:${event}`;
export const evuKey = (date: string, event: string): string => `evu:${date}:${event}`;
