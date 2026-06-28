// 行動ログ（離脱分析用ファネル）の共通定義。
// /api/track が日次でカウントし、/api/report/weekly が週次で集計してメール送信する。
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
  rakuten_buy: "仕入れる",
  listing_open: "出品をはじめた",
  listed: "出品が完了",
  sold: "売れた",
};

// 会員登録(ログイン)コンバージョン。線形ファネルには乗せない（継続率/ボトルネック計算を歪めないため別枠）。
// signup=ログイン/登録の合計、signup_from_*=どのナッジ経由で登録に至ったかの帰属。
export const SIGNUP_EVENTS = [
  "signup",
  "signup_from_dashboard",
  "signup_from_listing",
  "signup_from_sold",
  "signup_from_connect",
  "signup_from_filter",
  "signup_from_article",
] as const;
export type SignupEvent = (typeof SIGNUP_EVENTS)[number];

export const SIGNUP_LABELS: Record<SignupEvent, string> = {
  signup: "ログイン/登録（合計）",
  signup_from_dashboard: "└ 成績ナッジ経由",
  signup_from_listing: "└ 出品成功ナッジ経由",
  signup_from_sold: "└ 売却ナッジ経由",
  signup_from_connect: "└ 連携ナッジ経由",
  signup_from_filter: "└ 並び替え/絞り込み経由",
  signup_from_article: "└ ガイド記事経由",
};

// 収益ファネル（有料化後の課金導線）。線形ファネルには乗せない（離脱率/継続率の計算を歪めないため別枠）。
// paywall_hit=未購読が利益商品で課金壁に到達(/pricing誘導)、checkout_start=申込ボタン押下、subscribed=課金成立(Webhook)。
export const BILLING_EVENTS = ["paywall_hit", "checkout_start", "subscribed"] as const;
export type BillingEvent = (typeof BILLING_EVENTS)[number];
export const BILLING_LABELS: Record<BillingEvent, string> = {
  paywall_hit: "課金壁に到達（未購読）",
  checkout_start: "申し込みを開始",
  subscribed: "購読成立（課金）",
};

// /api/track と recordFunnelEvent が受け付けるイベントの allowlist（線形ファネル＋登録＋収益）。
export const TRACKED_EVENTS: readonly string[] = [...FUNNEL_EVENTS, ...SIGNUP_EVENTS, ...BILLING_EVENTS];

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
