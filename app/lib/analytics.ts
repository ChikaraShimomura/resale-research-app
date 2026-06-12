// GA4 イベント送信の共通ヘルパー。広告のコンバージョン計測に使う。
// gtag は layout.tsx で読み込み済み（同意モードv2対応）。未読込/SSR時は無害にスキップ。
type GtagParams = Record<string, string | number | boolean | undefined>;

export function track(event: string, params?: GtagParams): void {
  if (typeof window === "undefined") return;
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (typeof g === "function") g("event", event, params ?? {});
}
