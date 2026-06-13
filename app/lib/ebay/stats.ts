// 「育てるダッシュボード」用：アプリ出品→売れた取引の集計と称号(ランク)。サーバー専用。
// 取引は端末(アクター)単位で KV のハッシュ ebay_deals:{actor} に蓄積する。
import { kv } from "@vercel/kv";

export const USD_JPY = 155; // listing.ts と一致
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;

const DEALS_KEY = (actor: string) => `ebay_deals:${actor}`;
const TTL_SECONDS = 365 * 24 * 60 * 60;

export interface Deal {
  purchase: number; // 楽天仕入れ値(JPY)
  points: number; // 基本ポイント
  title: string;
  listedAt: string;
  soldUsd?: number; // eBay売値(USD)
  soldAt?: string;
}

// 出品時：取引を記録（売却情報があれば壊さないようマージ）。
export async function recordListed(
  actor: string,
  productId: string,
  d: { purchase: number; points: number; title: string; listedAt: string }
): Promise<void> {
  try {
    const existing = (await kv.hget<Deal>(DEALS_KEY(actor), productId)) ?? null;
    // 既に記録済み（再出品・下書き再公開）は金額・listedAt・売却情報を維持し、上書きしない
    if (!existing) {
      await kv.hset(DEALS_KEY(actor), { [productId]: { ...d } });
    }
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 売却検知時：売値を記録（出品記録がある＆未記録のときだけ）。
export async function recordSold(
  actor: string,
  productId: string,
  soldUsd: number,
  soldAt: string
): Promise<void> {
  try {
    const existing = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    if (!existing || existing.soldUsd != null) return;
    await kv.hset(DEALS_KEY(actor), { [productId]: { ...existing, soldUsd, soldAt } });
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
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

export interface Stats {
  soldCount: number;
  listedCount: number;
  totalPurchase: number; // 仕入れ合計(JPY・売れたもの)
  totalSales: number; // 売上合計(JPY換算)
  totalProfit: number; // 利益(売上-仕入れ-手数料+基本ポイント)
  totalPoints: number; // 基本ポイント累計(売れたもの)
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
  const all = Object.values(deals);
  const sold = all.filter((d) => d.soldUsd != null);

  let totalPurchase = 0;
  let totalSales = 0;
  let totalProfit = 0;
  let totalPoints = 0;
  for (const d of sold) {
    const saleJpy = Math.round((d.soldUsd ?? 0) * USD_JPY);
    const fee = Math.round(saleJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED;
    totalPurchase += d.purchase;
    totalSales += saleJpy;
    totalProfit += saleJpy - fee - d.purchase + (d.points ?? 0);
    totalPoints += d.points ?? 0;
  }

  const { rank, nextRank } = rankFor(totalProfit);
  return {
    soldCount: sold.length,
    listedCount: all.length,
    totalPurchase,
    totalSales,
    totalProfit,
    totalPoints,
    rank,
    nextRank,
    toNext: nextRank ? Math.max(0, nextRank.min - totalProfit) : 0,
  };
}
