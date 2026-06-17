// 「楽天で仕入れる」を押した端末では eBay自動出品 がアクティブになる（localStorage rkt_{id}="1"）。
// その商品は一覧の先頭に固定したいので、ID取得と先頭固定のユーティリティをここに集約する。

export function readUnlockedIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("rkt_") && localStorage.getItem(k) === "1") {
        const id = k.slice(4);
        // 出品が完了した商品は先頭固定の対象外（ソートで上に来続けて鬱陶しくならないように）
        if (localStorage.getItem(`listed_${id}`) !== "1") ids.add(id);
      }
    }
  } catch {
    /* noop */
  }
  return ids;
}

// 「自分がeBayに出品済み」の商品ID（localStorage listed_{id}="1"）。
// 出品したら本人の検索一覧から隠して「出品中一覧へ移った」状態にするのに使う（端末単位）。
export function readListedIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("listed_") && localStorage.getItem(k) === "1") {
        ids.add(k.slice("listed_".length));
      }
    }
  } catch {
    /* noop */
  }
  return ids;
}

// アクティブ（仕入れ中）の商品を先頭へ固定する。売却済みは対象外、それ以外の並びは維持。
export function pinUnlockedFirst<T extends { id: string }>(
  products: T[],
  unlockedIds: Set<string>,
  soldIds?: Set<string>
): T[] {
  if (unlockedIds.size === 0) return products;
  const isPinned = (p: T) => unlockedIds.has(p.id) && !soldIds?.has(p.id);
  const pinned = products.filter(isPinned);
  if (pinned.length === 0) return products;
  return [...pinned, ...products.filter((p) => !isPinned(p))];
}
