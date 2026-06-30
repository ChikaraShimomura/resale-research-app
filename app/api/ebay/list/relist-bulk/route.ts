import { kv } from "@vercel/kv";
import { getActorId } from "../../../../lib/auth/actor";
import { getTeamContext } from "../../../../lib/auth/teamActor";
import { getCurrentUserEmail } from "../../../../lib/auth/plan";
import { isAdmin } from "../../../../lib/auth/admin";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { republishOfferForSku } from "../../../../lib/ebay/listing";
import { skuForProduct } from "../../../../lib/ebay/sellApi";
import type { Deal } from "../../../../lib/ebay/stats";

// オーナー専用の一括再出品。保持済み(UNPUBLISHED)オファーをそのまま再公開し、台帳を「出品中」へ戻す。
// 用途：誤って自動停止された出品をまとめて復活する等（価格/カテゴリ/Item Specifics/ポリシーは元のまま）。
// GET /api/ebay/list/relist-bulk?ids=used-hardoff-1,used-hardoff-2,...  （ログイン中のオーナーがブラウザで開く）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const email = await getCurrentUserEmail();
  if (!isAdmin(email)) return Response.json({ ok: false, error: "管理者のみ実行できます。" }, { status: 403 });

  const viewer = await getActorId();
  if (!viewer) return Response.json({ ok: false, connected: false }, { status: 401 });
  // 台帳(ebay_deals/満了枠)=dataActor、eBayトークン=ebayActor（publish と同じ解決）。
  const { dataActor, ebayActor } = await getTeamContext();
  const actor = dataActor ?? viewer;
  const ebayActorId = ebayActor ?? viewer;
  const token = await getValidAccessToken(ebayActorId);
  if (!token) return Response.json({ ok: false, connected: false }, { status: 401 });

  const ids = (new URL(req.url).searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return Response.json({ ok: false, error: "ids をカンマ区切りで指定してください。" }, { status: 400 });

  const deals = (await kv.hgetall<Record<string, Deal>>(`ebay_deals:${actor}`)) ?? {};
  const results: { id: string; ok: boolean; listingId?: string; alreadyLive?: boolean; error?: string }[] = [];

  for (const id of ids) {
    const d = deals[id];
    if (!d || typeof d !== "object") {
      results.push({ id, ok: false, error: "出品データが見つかりません。" });
      continue;
    }
    const sku = d.sku ?? skuForProduct(id);
    const r = await republishOfferForSku(token, sku);
    if (!r.ok) {
      results.push({ id, ok: false, error: r.error });
      continue;
    }
    // 台帳を「出品中」へ戻す：stoppedAt/誤sourceStatus を消し、新しい listingId を反映。満了枠も再取得。
    const nd: Record<string, unknown> = { ...d };
    delete nd.stoppedAt;
    delete nd.sourceStatus;
    delete nd.sourceCheckedBy;
    delete nd.sourceCheckedAt;
    delete nd.stopFailedCount;
    delete nd.stopFailedAt;
    nd.sku = sku; // 使用SKUを台帳に保存＝次回の編集/停止で getListingSku が同じSKUを引け、固定SKUへのズレ(オファー不一致)を防ぐ。
    if (r.listingId) nd.listingId = r.listingId;
    await kv.hset(`ebay_deals:${actor}`, { [id]: nd });
    try {
      await kv.sadd(`listing_actors:${id}`, actor);
      await kv.expire(`listing_actors:${id}`, 90 * 24 * 3600);
    } catch {
      /* 満了枠の再取得失敗は致命でない（出品自体は復活済み） */
    }
    results.push({ id, ok: true, listingId: r.listingId, alreadyLive: r.alreadyLive });
  }

  const okN = results.filter((x) => x.ok).length;
  return Response.json({ ok: true, relisted: okN, failed: results.length - okN, results });
}
