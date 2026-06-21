// 「楽天で仕入れる」押下を localStorage(rkt_{id}="1") に記録する。※これは記録用で、出品をロックするゲートではない。
// ⚠️ 2026-06-21 「rkt_ 商品を一覧の先頭に固定する」挙動は廃止（ユーザー判断）。
//    rkt_ はオンボーディングの「仕入れた」判定(OnboardingChecklist)で使うため残す。先頭固定だけをやめた。

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

// 運営が手動復活した商品(restored)だけを先頭へ固定する。restored はニッチ等でおすすめ順だと埋もれるため、
// 確実に見つかるよう先頭に出す（運営のキュレーション用途・ユーザー操作とは無関係）。売却済みは対象外、他の並びは維持。
// ※「楽天で仕入れた(rkt_)」端末の先頭固定は 2026-06-21 に廃止した。
export function pinRestoredFirst<T extends { id: string; restored?: boolean }>(
  products: T[],
  soldIds?: Set<string>
): T[] {
  const isPinned = (p: T) => p.restored === true && !soldIds?.has(p.id);
  const pinned = products.filter(isPinned);
  if (pinned.length === 0) return products;
  return [...pinned, ...products.filter((p) => !isPinned(p))];
}
