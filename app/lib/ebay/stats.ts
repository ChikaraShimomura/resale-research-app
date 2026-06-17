// 「育てるダッシュボード」用：アプリ出品→売れた取引の集計と称号(ランク)。サーバー専用。
// 取引は端末(アクター)単位で KV のハッシュ ebay_deals:{actor} に蓄積する。
import { kv } from "@vercel/kv";
import { skuForProduct } from "./sellApi";

export const USD_JPY = 155; // listing.ts と一致
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;

const DEALS_KEY = (actor: string) => `ebay_deals:${actor}`;
// SKU対応表。eBayに「公開できた(result.ok)」時だけ書かれる＝実際に出品できた証跡。listing.ts と一致。
const SKU_MAP_KEY = (actor: string) => `ebay_sku_map:${actor}`;
const TTL_SECONDS = 730 * 24 * 60 * 60; // 取引履歴は2年保持（出品/出荷の都度 expire を再延長）

// 「実際に出品できた商品」だけを通す判定を返す。
// 旧仕様では下書き/本人確認待ちでも deal を記録していたため、SKU対応表に載っているものだけを
// 「出品中/出品実績」として扱う（公開できなかった取りこぼしを集計から除外する）。
async function publishedFilter(actor: string): Promise<(productId: string) => boolean> {
  let skuMap: Record<string, string> = {};
  try {
    skuMap = (await kv.hgetall<Record<string, string>>(SKU_MAP_KEY(actor))) ?? {};
  } catch {
    /* noop */
  }
  const publishedSkus = new Set(Object.keys(skuMap));
  return (productId: string) => publishedSkus.has(skuForProduct(productId));
}

export interface Deal {
  purchase: number; // 楽天仕入れ値(JPY)
  points: number; // 基本ポイント
  title: string;
  imageUrl?: string; // 楽天画像（一覧のサムネ用。新規出品から保存）
  listedAt: string;
  listingId?: string; // eBayの公開ID（https://www.ebay.com/itm/{listingId}）。出品成功時に保存。マイページの「写真追加」で当該出品へ直リンクするのに使う
  soldUsd?: number; // eBay売値(USD)
  soldAt?: string;
}

// 出品時：取引を記録（売却情報があれば壊さないようマージ）。
export async function recordListed(
  actor: string,
  productId: string,
  d: { purchase: number; points: number; title: string; imageUrl?: string; listedAt: string; listingId?: string }
): Promise<void> {
  try {
    const existing = (await kv.hget<Deal>(DEALS_KEY(actor), productId)) ?? null;
    // 既に記録済み（再出品・下書き再公開）は金額・listedAt・売却情報を維持し、上書きしない
    if (!existing) {
      await kv.hset(DEALS_KEY(actor), { [productId]: { ...d } });
    } else if (d.listingId && existing.listingId !== d.listingId) {
      // 再出品で公開IDが変わった/初めて取れた時だけ listingId を更新（金額・出品日・売却情報は維持）
      await kv.hset(DEALS_KEY(actor), { [productId]: { ...existing, listingId: d.listingId } });
    }
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 売却検知時：売値を記録（未記録のときだけ）。
// 出品記録(existing)が無くても売却は取りこぼさず記録する：仕入れ・ポイント等は無し(0)の
// 最小Dealをupsertする。既存があれば売却情報だけ足し、既に売却記録済みなら何もしない。
export async function recordSold(
  actor: string,
  productId: string,
  soldUsd: number,
  soldAt: string
): Promise<void> {
  try {
    const existing = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    if (existing?.soldUsd != null) return; // 既に売却記録済み
    const base: Deal = existing ?? { purchase: 0, points: 0, title: "", listedAt: soldAt };
    await kv.hset(DEALS_KEY(actor), { [productId]: { ...base, soldUsd, soldAt } });
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 出品中（未売却）の取引一覧。マイページで個別に「やめた/売れた」を手動調整するため。
export interface LiveDeal {
  id: string;
  title: string;
  listedAt: string;
  purchase: number; // 楽天仕入れ(送料込・JPY)
  imageUrl: string; // 楽天画像（無い古いdealは現行カタログから補完。見つからなければ空）
  listingId?: string; // eBay公開ID。あれば「写真追加」をその出品ページへ直リンク（無い旧データは出品一覧へ）
}
export interface SoldDeal {
  id: string;
  title: string;
  imageUrl: string;
  soldAt: string;
  soldJpy: number; // 売れた金額(JPY換算)
  profitJpy: number; // 利益(手数料・仕入れ・ポイント込み)
  purchase: number; // 楽天仕入れ(送料込・JPY)
}

// マイページ用：出品中(未売却・公開済み)と輸出した(売却済み)の取引一覧をまとめて返す。
// deals ハッシュ1回・SKU対応表1回・画像補完カタログ1回で両方を組み立てる。
export async function listDealsForUser(actor: string): Promise<{ live: LiveDeal[]; sold: SoldDeal[] }> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    return { live: [], sold: [] };
  }
  const isPublished = await publishedFilter(actor);
  const entries = Object.entries(deals);
  const liveEntries = entries.filter(([id, d]) => d.soldUsd == null && isPublished(id)); // 未売却かつ公開済み
  const soldEntries = entries.filter(([, d]) => d.soldUsd != null); // 売却済み（実取引なので全部有効）

  // 画像/タイトル未保存の古いdealは、現行カタログ(profitable_products)から補完する。
  // さらに補完できた値は deal 自体に焼き込み直す＝以後はカタログに依存しない（商品が利益商品から
  // 外れても出品中/販売した一覧の表示が欠けないようにする。新規dealは出品時に保存済みで対象外）。
  const catInfo: Record<string, { imageUrl?: string; title?: string }> = {};
  const needBackfill = [...liveEntries, ...soldEntries].some(([, d]) => !d.imageUrl || !d.title);
  if (needBackfill) {
    try {
      const products = (await kv.get<{ id: string; imageUrl?: string; title?: string }[]>("profitable_products")) ?? [];
      for (const p of products) if (p?.id) catInfo[p.id] = { imageUrl: p.imageUrl, title: p.title };
    } catch {
      /* noop */
    }
    // 補完できた分だけ deal に保存し直す（best-effort・カタログがまだ持っているうちに永続化）。
    const heal: Record<string, Deal> = {};
    for (const [id, d] of [...liveEntries, ...soldEntries]) {
      const img = !d.imageUrl ? catInfo[id]?.imageUrl : undefined;
      const ttl = !d.title ? catInfo[id]?.title : undefined;
      if (img || ttl) heal[id] = { ...d, ...(img ? { imageUrl: img } : {}), ...(ttl ? { title: ttl } : {}) };
    }
    if (Object.keys(heal).length) {
      try {
        await kv.hset(DEALS_KEY(actor), heal);
        await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
      } catch {
        /* noop */
      }
    }
  }

  const live: LiveDeal[] = liveEntries
    .map(([id, d]) => ({
      id,
      title: d.title || catInfo[id]?.title || "",
      listedAt: d.listedAt || "",
      purchase: d.purchase ?? 0,
      imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
      listingId: d.listingId,
    }))
    .sort((a, b) => (b.listedAt || "").localeCompare(a.listedAt || "")); // 新しい順

  const sold: SoldDeal[] = soldEntries
    .map(([id, d]) => {
      const saleJpy = Math.round((d.soldUsd ?? 0) * USD_JPY);
      const fee = Math.round(saleJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED;
      return {
        id,
        title: d.title || catInfo[id]?.title || "",
        imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
        soldAt: d.soldAt || "",
        soldJpy: saleJpy,
        profitJpy: saleJpy - fee - (d.purchase ?? 0) + (d.points ?? 0),
        purchase: d.purchase ?? 0,
      };
    })
    .sort((a, b) => (b.soldAt || "").localeCompare(a.soldAt || "")); // 新しい順

  return { live, sold };
}

// 「実際に出品中(公開済み) or 売却済みの商品ID」を返す。検索一覧で本人の出品済みを隠す／仕入れ中一覧から
// 除外する、の両方で使う。ログイン時は actor=acct:{uuid} なのでアカウントに紐づき別端末でも同じIDが返る。
// 重要: deal のキーがあっても sku_map が無く未売却の“幽霊deal”(eBay連携の解除等で sku_map だけ消えた状態)は
// 「出品済み」とみなさない。みなすと、その商品が検索からも仕入れ中からも消えてどのリストにも出なくなるため
// （実際にはまた仕入れ/出品できる状態）。出品中(isPublished) か 売却済み(soldUsd) のものだけを返す。
export async function listListedProductIds(actor: string): Promise<string[]> {
  try {
    const deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
    const isPublished = await publishedFilter(actor);
    return Object.entries(deals)
      .filter(([id, d]) => d?.soldUsd != null || isPublished(id))
      .map(([id]) => id);
  } catch {
    return [];
  }
}

// 「出品をやめた」：成績から取引を削除する（hdel）。
export async function removeDeal(actor: string, productId: string): Promise<void> {
  try {
    await kv.hdel(DEALS_KEY(actor), productId);
  } catch {
    /* noop */
  }
}

export interface Rank {
  name: string;
  icon: string;
  min: number; // 昇格に必要な利益累計(JPY)
}

// 利益累計で昇格する称号。
export const RANKS: Rank[] = [
  { name: "輸出ルーキー", icon: "🌱", min: 0 },
  { name: "輸出みならい", icon: "🔰", min: 5000 },
  { name: "輸出ハンター", icon: "⚡", min: 30000 },
  { name: "輸出プロ", icon: "🔥", min: 100000 },
  { name: "輸出マスター", icon: "👑", min: 300000 },
  { name: "輸出レジェンド", icon: "💎", min: 1000000 },
];

export function rankFor(profit: number): { rank: Rank; nextRank: Rank | null } {
  let rank = RANKS[0];
  for (const r of RANKS) if (profit >= r.min) rank = r;
  const idx = RANKS.indexOf(rank);
  return { rank, nextRank: idx < RANKS.length - 1 ? RANKS[idx + 1] : null };
}

// 月別(売却月)集計。マイページの「利益の推移」グラフ用。
export interface MonthPoint {
  month: string; // "2026-06"
  label: string; // "6月"
  profit: number;
  sales: number;
  purchase: number;
  count: number;
}

export interface Stats {
  soldCount: number;
  listedCount: number;
  listedPurchase: number; // 出品中(未売却)の仕入れ合計(JPY・楽天価格+国内送料)
  totalPurchase: number; // 仕入れ合計(JPY・売れたもの)
  totalSales: number; // 売上合計(JPY換算)
  totalProfit: number; // 利益(売上-仕入れ-手数料+基本ポイント)
  totalPoints: number; // 基本ポイント累計(売れたもの)
  totalFees: number; // eBay手数料合計(JPY)
  avgProfit: number; // 1件あたり平均利益(売れたもの)
  bestProfit: number; // 最も稼いだ1取引の利益
  monthly: MonthPoint[]; // 月別集計(売却月・昇順)
  rank: Rank;
  nextRank: Rank | null;
  toNext: number; // 次の称号まで(円)
}

export async function getStats(actor: string): Promise<Stats> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    /* noop */
  }
  const isPublished = await publishedFilter(actor);
  const entries = Object.entries(deals);
  const sold = entries.filter(([, d]) => d.soldUsd != null).map(([, d]) => d); // 売却済み（実取引なので全部有効）
  // 出品中＝未売却 かつ 実際に出品できた（SKU対応表にある）ものだけ。旧仕様の下書き/本人確認待ちは除外。
  const live = entries.filter(([id, d]) => d.soldUsd == null && isPublished(id)).map(([, d]) => d);
  const listedPurchase = live.reduce((a, d) => a + (d.purchase ?? 0), 0);

  let totalPurchase = 0;
  let totalSales = 0;
  let totalProfit = 0;
  let totalPoints = 0;
  let totalFees = 0;
  let bestProfit = 0;
  const byMonth = new Map<string, MonthPoint>();
  for (const d of sold) {
    const saleJpy = Math.round((d.soldUsd ?? 0) * USD_JPY);
    const fee = Math.round(saleJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED;
    const profit = saleJpy - fee - d.purchase + (d.points ?? 0);
    totalPurchase += d.purchase;
    totalSales += saleJpy;
    totalFees += fee;
    totalProfit += profit;
    totalPoints += d.points ?? 0;
    if (profit > bestProfit) bestProfit = profit;
    // 売却月で集計（soldAt が "YYYY-MM..." のときだけ）
    const ym = (d.soldAt ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) {
      const cur =
        byMonth.get(ym) ?? { month: ym, label: `${Number(ym.slice(5, 7))}月`, profit: 0, sales: 0, purchase: 0, count: 0 };
      cur.profit += profit;
      cur.sales += saleJpy;
      cur.purchase += d.purchase;
      cur.count += 1;
      byMonth.set(ym, cur);
    }
  }
  const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  const { rank, nextRank } = rankFor(totalProfit);
  return {
    soldCount: sold.length,
    listedCount: sold.length + live.length, // 実際に出品できたもの（出品中＋売却済み）。下書き等は含めない
    listedPurchase,
    totalPurchase,
    totalSales,
    totalProfit,
    totalPoints,
    totalFees,
    avgProfit: sold.length ? Math.round(totalProfit / sold.length) : 0,
    bestProfit,
    monthly,
    rank,
    nextRank,
    toNext: nextRank ? Math.max(0, nextRank.min - totalProfit) : 0,
  };
}
