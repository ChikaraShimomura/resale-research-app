// 仕入れ元(楽天)が「売り切れ/リンク切れ」になった出品を、eBayから自動で取り下げる。サーバー専用。
// 検知は checkListings.mjs (cron, 楽天API) が deal.sourceStatus に dead/soldout を立てる。
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
    const sku = d.sku ?? skuForProduct(productId);
    const r = await withdrawListingForSku(token, sku); // 冪等(未公開でもok)
    if (!r.ok) {
      // 取り下げ失敗＝eBayにゾンビ出品が残るリスク（楽天売切なのにeBay売出中＝欠品販売に直結）。
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
    // sku未保存の旧deal×自己修復SKU(rr-{id}-{乱数})だと基本SKUでオファーが当たらず ended=false(未検出)になり得る。
    // 「本当に取り下げた確証なし」なので停止扱い/recapにはしない（誤報告防止）。ただし黙って continue すると
    // 楽天売切なのに eBay 売出中(欠品販売)のゾンビ出品が放置されるため、取り下げ失敗と同じく手動対応フラグを立てて可視化する。
    if (!r.ended && !d.sku) {
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
