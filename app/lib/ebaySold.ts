// 「自分がeBayで売れた商品ID」をクライアントから取得するヘルパー。
// 表示側(一覧)で売却済みを最下部化/非表示にするために使う。
// 30分に1回だけ eBay と同期(POST)し、それ以外は保存済み(GET)を高速に読む。

const SYNC_GATE_KEY = "ebay_sold_synced_at";
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

export interface SoldState {
  ids: Set<string>;
  needsReconnect: boolean;
}

export async function fetchSoldIds(): Promise<SoldState> {
  // 直近30分以内に同期済みなら GET（保存済みを読むだけ）。それ以外は POST で同期。
  let doSync = true;
  try {
    const last = Number(localStorage.getItem(SYNC_GATE_KEY) || 0);
    doSync = !Number.isFinite(last) || Date.now() - last > SYNC_INTERVAL_MS;
  } catch {
    /* localStorage不可なら同期する */
  }

  try {
    const res = await fetch("/api/ebay/sold", {
      method: doSync ? "POST" : "GET",
      cache: "no-store",
    });
    const j = (await res.json()) as { ids?: string[]; needsReconnect?: boolean };
    if (doSync) {
      try {
        localStorage.setItem(SYNC_GATE_KEY, String(Date.now()));
      } catch {
        /* noop */
      }
    }
    return { ids: new Set(j.ids ?? []), needsReconnect: !!j.needsReconnect };
  } catch {
    return { ids: new Set(), needsReconnect: false };
  }
}
