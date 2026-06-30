// 仕入れ元が「売り切れ/リンク切れ」になった出品を、eBayから自動で取り下げる。サーバー専用。
// 検知は checkListings.mjs (cron) が deal.sourceStatus に dead/soldout を立てる。
// ここはその検知結果を消費して「自動停止＋出品停止中へ移動＋recap記録」を行う。
// 欠品キャンセル(売れたのに送れない)を防ぐのが目的＝止めすぎても再出品で戻せる安全側。
import { kv } from "@vercel/kv";
import { getValidAccessToken } from "./tokens";
import { withdrawListingForSku } from "./listing";
import { markStopped, type Deal } from "./stats";
import { skuForProduct } from "./sellApi";

export interface AutoStopEntry {
  id: string;
  title: string;
  imageUrl: string;
  // dead=リンク切れ(掲載終了/閉店) / soldout=売り切れ / overpriced=複数タイプ(箱単位)で原価誤認＝不採算
  reason: "dead" | "soldout" | "overpriced";
  at: string;
}

const RECAP_KEY = (actor: string) => `auto_stopped:${actor}`;
const RECAP_TTL = 30 * 24 * 3600; // ユーザーがモーダルで確認するまで保持(最長30日)

// 箱価格(複数タイプ)で原価を誤認＝不採算と判定された商品IDの集合を取得する。
// refresh.mjs が reconcileSourcePages で `catalog_overpriced_ids`(JSON配列)に毎回 全置換で書く。
// 「除外するときはeBay出品停止もする」方針の配線：カタログから外すだけでなく、出品中があれば停止する。
async function fetchOverpricedIds(): Promise<Set<string>> {
  try {
    const arr = await kv.get<string[]>("catalog_overpriced_ids");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// 1アクターぶん：出品中(未売却・未停止)で「仕入れ元が売切/リンク切れ(dead/soldout) または 箱価格で不採算(overpriced)」の
// 出品をeBayから取り下げ、出品停止中へ移し、recapに積む。実際に停止できたぶんを返す（冪等：停止済みは skip）。
// overpricedIds を渡すと再取得しない（cronが全アクターで使い回す用。未指定なら自前取得＝単発呼び出し用）。
export async function reconcileActorStops(actor: string, overpricedIds?: Set<string>): Promise<AutoStopEntry[]> {
  const token = await getValidAccessToken(actor);
  if (!token) return []; // 連携切れ等は何もしない（次回再連携後に拾う）
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(`ebay_deals:${actor}`)) ?? {};
  } catch {
    return [];
  }
  // SKU対応表(sku→productId)の逆引き(productId→sku)。古いdeal(d.sku未保存)でも、出品時に保存した実SKU
  // （自己修復の rr-{id}-{乱数} を含む）を引いて取り下げ対象にできる＝固定SKU(rr-{id})では当たらず、仕入れ元売切なのに
  //  eBay売出中（欠品販売のゾンビ出品）が放置される穴を根治する。ループ前に1回だけ読む（hgetall 1回）。
  const skuByProduct = new Map<string, string>();
  try {
    const map = (await kv.hgetall<Record<string, string>>(`ebay_sku_map:${actor}`)) ?? {};
    for (const [sku, pid] of Object.entries(map)) if (pid && !skuByProduct.has(pid)) skuByProduct.set(pid, sku);
  } catch {
    /* 逆引き不能でも d.sku/固定SKU で続行 */
  }
  const overpriced = overpricedIds ?? (await fetchOverpricedIds());
  const stopped: AutoStopEntry[] = [];
  for (const [productId, d] of Object.entries(deals)) {
    if (!d || typeof d !== "object") continue;
    if (d.soldUsd != null || d.stoppedAt != null) continue; // 売却済み/停止済みは対象外
    // 停止理由：仕入れ元の死活(dead/soldout・実ページ権威)＞箱価格不採算(overpriced・refresh判定)。
    const reason: AutoStopEntry["reason"] | null =
      d.sourceStatus === "dead" || d.sourceStatus === "soldout"
        ? d.sourceStatus
        : overpriced.has(productId)
        ? "overpriced"
        : null;
    if (!reason) continue; // 検知フラグが立っているものだけ
    // SKU解決：deal保存値 ＞ SKU対応表の逆引き(自己修復SKUもここで拾う) ＞ 固定SKU(rr-{id})。
    const mappedSku = d.sku ?? skuByProduct.get(productId) ?? null;
    const sku = mappedSku ?? skuForProduct(productId);
    const r = await withdrawListingForSku(token, sku); // 冪等(未公開でもok)
    if (!r.ok) {
      // 取り下げ失敗＝eBayにゾンビ出品が残るリスク（仕入れ元売切なのにeBay売出中＝欠品販売に直結）。
      // 無音でリトライし続けず、失敗回数を deal に記録。続くようなら MyListings が手動対応を促す。
      try {
        const fails = (Number(d.stopFailedCount) || 0) + 1;
        await kv.hset(`ebay_deals:${actor}`, {
          [productId]: { ...d, stopFailedCount: fails, stopFailedAt: new Date().toISOString() },
        });
      } catch {
        /* noop */
      }
      continue;
    }
    // r.ended=false ＝ 解決したSKUに公開中オファーが無い（＝既に取り下げ済み/掲載終了）。
    // SKUの手掛かりが一切無い(mappedSku=null)＝出品記録が無く実SKUも特定できない場合は、ゾンビ出品の可能性も極めて低い。
    // ここで stopFailedCount を増やすと「既に止まっている」品にも手動対応フラグが量産され誤報になるため、無音でスキップする。
    // （実SKUが分かる品=mappedSku有 は上の withdraw で確実に取り下げ済み＝この穴に落ちない＝ゾンビは残らない。）
    if (!r.ended && !mappedSku) continue;
    await markStopped(actor, productId); // 出品停止中一覧へ（sourceStatus は維持＝理由が残る）
    stopped.push({ id: productId, title: d.title ?? "", imageUrl: d.imageUrl ?? "", reason, at: new Date().toISOString() });
  }
  if (stopped.length) {
    const add: Record<string, AutoStopEntry> = {};
    for (const e of stopped) add[e.id] = e;
    try {
      await kv.hset(RECAP_KEY(actor), add);
      await kv.expire(RECAP_KEY(actor), RECAP_TTL);
    } catch {
      /* recap記録失敗は致命でない（停止自体は完了） */
    }
  }
  return stopped;
}

// 未確認の自動停止recap（モーダル表示用）。新しい順。
export async function getPendingRecap(actor: string): Promise<AutoStopEntry[]> {
  try {
    const h = (await kv.hgetall<Record<string, AutoStopEntry>>(RECAP_KEY(actor))) ?? {};
    return Object.values(h)
      .filter((e) => e && e.id)
      .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  } catch {
    return [];
  }
}

// ユーザーがモーダルで確認した＝recapをクリア。
export async function clearRecap(actor: string): Promise<void> {
  try {
    await kv.del(RECAP_KEY(actor));
  } catch {
    /* noop */
  }
}
