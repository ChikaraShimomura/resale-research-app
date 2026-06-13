// GA4 イベント送信の共通ヘルパー。広告のコンバージョン計測に使う。
// gtag は layout.tsx で読み込み済み（同意モードv2対応）。未読込/SSR時は無害にスキップ。
type GtagParams = Record<string, string | number | boolean | undefined>;

export function track(event: string, params?: GtagParams): void {
  if (typeof window === "undefined") return;
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (typeof g === "function") g("event", event, params ?? {});
}

// 行動ログ（離脱分析用）。/api/track にファネルイベントを送り、KVで日次集計する。
// GA4とは別系統。ページ離脱に強い sendBeacon を優先し、失敗してもユーザー体験を妨げない。
export function logEvent(event: string): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ event });
    const nav = navigator as Navigator & { sendBeacon?: (url: string, data?: BodyInit) => boolean };
    if (typeof nav.sendBeacon === "function") {
      nav.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* noop */
  }
}
