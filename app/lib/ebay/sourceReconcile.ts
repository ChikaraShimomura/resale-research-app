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
  reason: "dead" | "soldout"; // dead=リンク切れ(掲載終了/閉店) / soldout=売り切れ
  at: string;
}

const RECAP_KEY = (actor: string) => `auto_stopped:${actor}`;
const RECAP_TTL = 30 * 24 * 3600; // ユーザーがモーダルで確認するまで保持(最長30日)

// 1アクターぶん：出品中(未売却・未停止)で sourceStatus が dead/soldout の出品をeBayから取り下げ、
// 出品停止中へ移し、recapに積む。実際に停止できたぶんを返す（冪等：停止済みは skip）。
export async function reconcileActorStops(actor: string): Promise<AutoStopEntry[]> {
  const token = await getValidAccessToken(actor);
  if (!token) return []; // 連携切れ等は何もしない（次回再連携後に拾う）
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(`ebay_deals:${actor}`)) ?? {};
  } catch {
    return [];
  }
  const stopped: AutoStopEntry[] = [];
  for (const [productId, d] of Object.entries(deals)) {
    if (!d || typeof d !== "object") continue;
    if (d.soldUsd != null || d.stoppedAt != null) continue; // 売却済み/停止済みは対象外
    const reason = d.sourceStatus;
    if (reason !== "dead" && reason !== "soldout") continue; // 検知フラグが立っているものだけ
    const sku = d.sku ?? skuForProduct(productId);
    const r = await withdrawListingForSku(token, sku); // 冪等(未公開でもok)
    if (!r.ok) continue; // 失敗は次回リトライ（フラグは残る）
    // sku未保存の旧deal×自己修復SKU(rr-{id}-{乱数})だと基本SKUでオファーが当たらず ended=false(未検出)になり得る。
    // その場合「本当に取り下げた確証なし」なので停止扱い/recapにせず次回送り（誤報告＝実出品が残るのを防ぐ）。
    if (!r.ended && !d.sku) continue;
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
