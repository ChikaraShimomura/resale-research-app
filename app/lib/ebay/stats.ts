// 「育てるダッシュボード」用：アプリ出品→売れた取引の集計と称号(ランク)。サーバー専用。
// 取引は端末(アクター)単位で KV のハッシュ ebay_deals:{actor} に蓄積する。
import { kv } from "@vercel/kv";
import { toRakutenProductUrl } from "../utils";
// USD_JPY は SSOT(landedCostCore・env駆動/既定155)に一本化（旧:ハードコード155）。再エクスポートで既存consumer維持。
import { USD_JPY } from "./landedCostCore.mjs";
export { USD_JPY };
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;

const DEALS_KEY = (actor: string) => `ebay_deals:${actor}`;
// SKU対応表。eBayに「公開できた(result.ok)」時だけ書かれる＝実際に出品できた証跡。listing.ts と一致。
const SKU_MAP_KEY = (actor: string) => `ebay_sku_map:${actor}`;
const TTL_SECONDS = 730 * 24 * 60 * 60; // 取引履歴は2年保持（出品/出荷の都度 expire を再延長）
const STOPPED_TTL_MS = 24 * 60 * 60 * 1000; // 出品停止中に入ってから24時間で自動削除（一覧・記録から消す）

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
  // SKU対応表は { sku: productId }。出品済み判定は「productId が値に含まれるか」で見る。
  // こうすると自己修復で sku が rr-{id}-{乱数} に変わっても、商品が出品中一覧から消えない
  // （旧データ＝sku=rr-{id} でも値は productId なので結果は同じ＝後方互換）。
  const publishedProductIds = new Set(Object.values(skuMap));
  return (productId: string) => publishedProductIds.has(productId);
}

export interface Deal {
  purchase: number; // 楽天仕入れ値(JPY)
  points: number; // 基本ポイント
  title: string;
  imageUrl?: string; // 楽天画像（一覧のサムネ用。新規出品から保存）
  sourceUrl?: string; // 楽天の商品ページ直URL（「仕入れ」ボタン用）。カタログから補完して焼き込む＝失効後も残る
  listedAt: string;
  listingId?: string; // eBayの公開ID（https://www.ebay.com/itm/{listingId}）。出品成功時に保存。マイページの「写真追加」で当該出品へ直リンクするのに使う
  sku?: string; // 実際に公開に使ったSKU（自己修復で rr-{id}-{乱数} になり得る）。アプリ内編集(価格/数量)の対象オファー特定に使う
  stoppedAt?: string; // 「出品停止」を押した日時(ISO)。出品停止中一覧に表示。再出品で解除。
  sourceStatus?: "dead" | "soldout"; // 仕入れ元(楽天)が掲載終了/売り切れの時に立つ（checkListings cronが~30分毎に更新）
  sourceCheckedAt?: string; // 仕入れ元の最終確認日時(ISO)
  priceDrift?: { nowJpy: number; pct: number; at: string }; // ④ 仕入れ元の現在価格が出品時原価を閾値以上上回った時に立つ（checkListings cron）
  stopFailedCount?: number; // 自動取り下げ(reconcileActorStops)の連続失敗回数。一定超で「手動でeBayから取り下げを」とUI表示
  stopFailedAt?: string; // 最後に自動取り下げが失敗した日時(ISO)
  soldUsd?: number; // eBay売値(USD)
  soldAt?: string;
}

// 出品時：取引を記録（売却情報があれば壊さないようマージ）。
export async function recordListed(
  actor: string,
  productId: string,
  d: { purchase: number; points: number; title: string; imageUrl?: string; sourceUrl?: string; listedAt: string; listingId?: string; sku?: string }
): Promise<void> {
  try {
    const existing = (await kv.hget<Deal>(DEALS_KEY(actor), productId)) ?? null;
    // 既に記録済み（再出品・下書き再公開）は金額・listedAt・売却情報を維持し、上書きしない
    if (!existing) {
      await kv.hset(DEALS_KEY(actor), { [productId]: { ...d } });
    } else if (
      (d.listingId && existing.listingId !== d.listingId) ||
      (d.sku && existing.sku !== d.sku) ||
      existing.stoppedAt != null
    ) {
      // 再出品/自己修復で公開ID・SKUが変わった/初めて取れた時だけ更新（金額・出品日・売却情報は維持）。
      // recordListed は公開成功時のみ呼ばれる＝再び出品中なので、停止フラグ(stoppedAt)は解除する。
      const next: Deal = {
        ...existing,
        ...(d.listingId ? { listingId: d.listingId } : {}),
        ...(d.sku ? { sku: d.sku } : {}),
      };
      delete next.stoppedAt;
      await kv.hset(DEALS_KEY(actor), { [productId]: next });
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
  sourceUrl?: string; // 楽天の商品ページ直URL（「仕入れ」ボタン）。無い旧deal/失効商品では undefined→商品名検索にフォールバック
  listingId?: string; // eBay公開ID。あれば「写真追加」をその出品ページへ直リンク（無い旧データは出品一覧へ）
  stoppedAt?: string; // 出品停止中一覧の項目に付く停止日時。出品中の項目では undefined。
  sourceStatus?: "dead" | "soldout"; // 仕入れ元(楽天)が掲載終了/売り切れの時に⚠️表示するためのフラグ
  priceDrift?: { nowJpy: number; pct: number; at: string }; // ④ 仕入れ元の値上がり警告（出品時原価を閾値超過）
  stopFailedCount?: number; // 自動取り下げが繰り返し失敗（一定超で「手動でeBayから取り下げを」と表示）
}
export interface SoldDeal {
  id: string;
  title: string;
  imageUrl: string;
  soldAt: string;
  soldJpy: number; // 売れた金額(JPY換算)
  profitJpy: number; // 現金利益(売上−手数料−仕入れ)。楽天ポイントは含めない＝別枠(points)で扱う
  purchase: number; // 楽天仕入れ(送料込・JPY)
}

// 出品停止中(未売却・stoppedAtあり)で、停止から24時間を過ぎた取引のID（自動削除の対象）。
// stoppedAt が不正・空のものは NaN 比較で false → 絶対に消さない（安全側）。
function expiredStopIds(deals: Record<string, Deal>, now: number): string[] {
  return Object.entries(deals)
    .filter(([, d]) => d && d.soldUsd == null && d.stoppedAt != null && now - Date.parse(d.stoppedAt) >= STOPPED_TTL_MS)
    .map(([id]) => id);
}

// 取引を完全削除する（deals本体＋SKU対応表の該当エントリ）。SKU対応表を残すと publishedFilter が
// 「出品中」と誤認し、その商品が検索一覧から消えたままになるため、値=productId のSKUキーも必ず消す
// （自己修復で rr-{id}-{乱数} になっていても値で拾えるので取りこぼさない）。
export async function deleteDealsWithSku(actor: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const idSet = new Set(ids);
  try {
    await kv.hdel(DEALS_KEY(actor), ...ids);
  } catch {
    /* noop */
  }
  try {
    const skuMap = (await kv.hgetall<Record<string, string>>(SKU_MAP_KEY(actor))) ?? {};
    const skuKeys = Object.entries(skuMap)
      .filter(([, pid]) => idSet.has(pid))
      .map(([sku]) => sku);
    if (skuKeys.length) await kv.hdel(SKU_MAP_KEY(actor), ...skuKeys);
  } catch {
    /* noop */
  }
}

// cron用：出品停止中に入って24時間を過ぎた取引をまとめて自動削除する。削除したIDを返す。
// 離席中でも auto-stop-cron(15分毎) から呼ばれ、ユーザーがマイページを開かなくても掃除される。
export async function pruneExpiredStops(actor: string): Promise<string[]> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    return [];
  }
  const ids = expiredStopIds(deals, Date.now());
  await deleteDealsWithSku(actor, ids);
  return ids;
}

// マイページ用：出品中(未売却・公開済み)と輸出した(売却済み)の取引一覧をまとめて返す。
// deals ハッシュ1回・SKU対応表1回・画像補完カタログ1回で両方を組み立てる。
export async function listDealsForUser(
  actor: string
): Promise<{ live: LiveDeal[]; stopped: LiveDeal[]; sold: SoldDeal[] }> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    return { live: [], stopped: [], sold: [] };
  }
  // 出品停止中に入って24時間を過ぎた取引は自動削除（読み込み時にも掃除＝cronが回らない間も即座に消える）。
  const expiredStops = expiredStopIds(deals, Date.now());
  if (expiredStops.length) {
    await deleteDealsWithSku(actor, expiredStops);
    for (const id of expiredStops) delete deals[id];
  }
  const isPublished = await publishedFilter(actor);
  const entries = Object.entries(deals);
  const soldEntries = entries.filter(([, d]) => d.soldUsd != null); // 売却済み（実取引なので全部有効）
  // 出品停止中＝未売却 かつ stoppedAt あり（出品中より優先して分類）。
  const stoppedEntries = entries.filter(([, d]) => d.soldUsd == null && d.stoppedAt != null);
  // 出品中＝未売却 かつ 停止していない かつ 公開済み。
  const liveEntries = entries.filter(([id, d]) => d.soldUsd == null && d.stoppedAt == null && isPublished(id));

  // 画像/タイトル未保存の古いdealは、現行カタログ(profitable_products)から補完する。
  // さらに補完できた値は deal 自体に焼き込み直す＝以後はカタログに依存しない（商品が利益商品から
  // 外れても出品中/販売した一覧の表示が欠けないようにする。新規dealは出品時に保存済みで対象外）。
  const catInfo: Record<string, { imageUrl?: string; title?: string; sourceUrl?: string }> = {};
  // 出品中/停止中は「仕入れ」ボタン用に楽天URL(sourceUrl)も要る（売却済みは不要なのでトリガに含めない）。
  const needBackfill =
    [...liveEntries, ...stoppedEntries, ...soldEntries].some(([, d]) => !d.imageUrl || !d.title) ||
    [...liveEntries, ...stoppedEntries].some(([, d]) => !d.sourceUrl);
  if (needBackfill) {
    try {
      const products =
        (await kv.get<{ id: string; imageUrl?: string; title?: string; source?: { url?: string } }[]>("profitable_products")) ?? [];
      for (const p of products)
        if (p?.id)
          catInfo[p.id] = { imageUrl: p.imageUrl, title: p.title, sourceUrl: toRakutenProductUrl(p.source?.url ?? "") || undefined };
    } catch {
      /* noop */
    }
    // カタログから外れた(rotate out)出品は psnap:{id} アーカイブ(2年保持・getProductById と同じ源)から補完する。
    // 失効済みの出品でも仕入れURL/画像/タイトルが届き、heal で焼き込めて needBackfill が収束する（毎ロードの全件再取得を断つ）。
    const missing = [...liveEntries, ...stoppedEntries].map(([id]) => id).filter((id) => !catInfo[id]?.sourceUrl);
    if (missing.length) {
      try {
        const snaps = (await kv.mget(...missing.map((id) => `psnap:${id}`))) as (
          { imageUrl?: string; title?: string; source?: { url?: string } } | null
        )[];
        missing.forEach((id, i) => {
          const s = snaps[i];
          if (!s) return;
          const prev = catInfo[id] ?? {};
          catInfo[id] = {
            imageUrl: prev.imageUrl ?? s.imageUrl,
            title: prev.title ?? s.title,
            sourceUrl: prev.sourceUrl ?? (toRakutenProductUrl(s.source?.url ?? "") || undefined),
          };
        });
      } catch {
        /* noop */
      }
    }
    // 補完できた分だけ deal に保存し直す（best-effort・カタログがまだ持っているうちに永続化）。
    const heal: Record<string, Deal> = {};
    for (const [id, d] of [...liveEntries, ...stoppedEntries, ...soldEntries]) {
      const img = !d.imageUrl ? catInfo[id]?.imageUrl : undefined;
      const ttl = !d.title ? catInfo[id]?.title : undefined;
      const src = !d.sourceUrl ? catInfo[id]?.sourceUrl : undefined;
      if (img || ttl || src)
        heal[id] = { ...d, ...(img ? { imageUrl: img } : {}), ...(ttl ? { title: ttl } : {}), ...(src ? { sourceUrl: src } : {}) };
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
      sourceUrl: d.sourceUrl || catInfo[id]?.sourceUrl || undefined,
      listingId: d.listingId,
      sourceStatus: d.sourceStatus, // 楽天の仕入れ元が売り切れ/リンク切れなら⚠️
      priceDrift: d.priceDrift, // ④ 仕入れ元の値上がり警告
      stopFailedCount: d.stopFailedCount, // 自動取り下げ連続失敗（手動対応を促す）
    }))
    .sort((a, b) => (b.listedAt || "").localeCompare(a.listedAt || "")); // 新しい順

  const stopped: LiveDeal[] = stoppedEntries
    .map(([id, d]) => ({
      id,
      title: d.title || catInfo[id]?.title || "",
      listedAt: d.listedAt || "",
      purchase: d.purchase ?? 0,
      imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
      sourceUrl: d.sourceUrl || catInfo[id]?.sourceUrl || undefined,
      listingId: d.listingId,
      stoppedAt: d.stoppedAt,
      sourceStatus: d.sourceStatus, // 自動停止の理由(売切/リンク切れ)を停止中一覧でも表示
    }))
    .sort((a, b) => (b.stoppedAt || "").localeCompare(a.stoppedAt || "")); // 停止が新しい順

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
        profitJpy: saleJpy - fee - (d.purchase ?? 0), // 現金利益（ポイントは含めない＝別枠）
        purchase: d.purchase ?? 0,
      };
    })
    .sort((a, b) => (b.soldAt || "").localeCompare(a.soldAt || "")); // 新しい順

  return { live, stopped, sold };
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
    // 売却済み・出品停止中・出品中は検索一覧に出さない（停止中は出品停止中一覧へ駐機）。
    return Object.entries(deals)
      .filter(([id, d]) => d?.soldUsd != null || d?.stoppedAt != null || isPublished(id))
      .map(([id]) => id);
  } catch {
    return [];
  }
}

// 出品に使われたSKUを返す（アプリ内編集／出品停止の対象オファー特定用）。無ければ null。
export async function getListingSku(actor: string, productId: string): Promise<string | null> {
  try {
    const deal = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    return deal?.sku ?? null;
  } catch {
    return null;
  }
}

// 「出品停止」：取引に停止フラグ(stoppedAt)を立て、出品停止中一覧へ移す。dealが無ければ何もしない
// （仕入れ中のみで未出品の商品など）。再出品(recordListed)で stoppedAt は自動解除される。
export async function markStopped(actor: string, productId: string): Promise<void> {
  try {
    const existing = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    if (!existing) return;
    await kv.hset(DEALS_KEY(actor), { [productId]: { ...existing, stoppedAt: new Date().toISOString() } });
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
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
  totalProfit: number; // 現金利益(売上-仕入れ-手数料)。楽天ポイントは含めない＝totalPoints で別枠
  totalPoints: number; // 楽天ポイント累計(売れたもの・おまけ。利益には含めない)
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
  // 出品中＝未売却 かつ 停止していない かつ 実際に出品できた（SKU対応表にある）ものだけ。
  const live = entries.filter(([id, d]) => d.soldUsd == null && d.stoppedAt == null && isPublished(id)).map(([, d]) => d);
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
    const profit = saleJpy - fee - d.purchase; // 現金利益（ポイントは含めない＝totalPoints で別集計）
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
