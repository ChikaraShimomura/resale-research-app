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
    if (j.ok !== true) return readListedIdsCache(); // 取得失敗(未ログイン等)は正本扱いしない＝掃除もしない
    const ids = new Set(j.ids ?? []);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify([...ids]));
    } catch {
      /* noop */
    }
    // ⭐ 端末の listed_{id} フラグ(出品直後の即時表示用)を正本(サーバーids)と突合して掃除する。
    //    出品停止→削除でサーバーから消えた商品の listed_ が端末に残り「出品済み・管理を見る」固着する不具合の自己修復。
    //    ⚠️ ok=true で ids が確実に取れた時だけ実行（fail-open の空配列で誤って全消ししない）。
    reconcileListedFlags(ids);
    return ids;
  } catch {
    return readListedIdsCache(); // 通信失敗時はキャッシュにフォールバック
  }
}

// 出品停止/削除した時に、その端末の「出品済み」フラグ(listed_{id})とアカウントキャッシュから当該IDを消す。
// MyListings の停止/削除成功時に呼ぶ＝カタログ(検索一覧)の「出品済み・管理を見る」が即座に再出品ボタンへ戻る。
export function clearListedFlag(id: string): void {
  try {
    localStorage.removeItem(`listed_${id}`);
    const cur = readListedIdsCache();
    if (cur.delete(id)) localStorage.setItem(CACHE_KEY, JSON.stringify([...cur]));
  } catch {
    /* noop */
  }
}

// サーバーの「出品済みID集合」を正本に、それに含まれない端末の listed_{id} フラグを除去する（自己修復）。
export function reconcileListedFlags(serverIds: Set<string>): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("listed_") && localStorage.getItem(k) === "1") {
        const id = k.slice("listed_".length);
        if (!serverIds.has(id)) stale.push(k);
      }
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* noop */
  }
}
