// 「自分が出品/販売済みの商品ID」をサーバー(アカウント単位)から取得するヘルパー。
// 検索一覧で本人の出品済みを隠す（＝出品中一覧へ"移す"）のに使う。
// ログインしていれば actor=acct:{uuid} なので別端末でも同じIDが返る（アカウントに紐づく）。
// 直近結果を localStorage にキャッシュし、次回ロード時に即座に隠せるようにする（チラつき防止＋オフライン耐性）。

const CACHE_KEY = "ebay_listed_ids";

export function readListedIdsCache(): Set<string> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export async function fetchListedIds(): Promise<Set<string>> {
  try {
    const res = await fetch("/api/ebay/listed-ids", { cache: "no-store" });
    const j = (await res.json()) as { ok?: boolean; ids?: string[] };
    const ids = new Set(j.ids ?? []);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify([...ids]));
    } catch {
      /* noop */
    }
    return ids;
  } catch {
    return readListedIdsCache(); // 通信失敗時はキャッシュにフォールバック
  }
}
