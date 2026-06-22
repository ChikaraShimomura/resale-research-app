// 管理者専用：eBay直近落札ベースで「過大評価（現状○→落札✕）」になった商品の、出品中リストを一括 withdraw。
// GET  = プレビュー（対象を返すだけ・停止しない）
// POST = 実行（各アカウントのトークンで offer/withdraw → dealを停止扱いに）
// eBay鍵は本番(Vercel)サーバーにしか無いため、停止は必ずここ（サーバー側）で行う＝ローカル/Pixel不可。
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { isAdmin } from "../../../lib/auth/admin";
import { kvReadOnly } from "../../../lib/kv";
import { ProfitProduct } from "../../../lib/profitFilter";
import { applySoldComp } from "../../../lib/ebay/soldComp";
import { applyDisplayProfit } from "../../../lib/displayProfit";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import { withdrawListingForSku } from "../../../lib/ebay/listing";
import { markStopped } from "../../../lib/ebay/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLOOR = 10; // /api/products と同じ「現金純利益率」フロア

interface Deal { stoppedAt?: string; soldAt?: string; sku?: string; listingId?: string; title?: string }
interface Target { conn: string; productId: string; sku: string; title: string; listingId?: string; rateListing: number; rateSold: number }

async function ensureAdmin(): Promise<boolean> {
  return isAdmin(await getCurrentUserEmail());
}

// 「過大評価」= 現在出品相場の純利益率は FLOOR 以上だが、直近落札に直すと FLOOR 未満になった商品。
// それらの「出品中（停止/売却でない）」ディールを全アカexpand横断で集める。
async function findTargets(): Promise<Target[]> {
  const products = (await kvReadOnly.get<ProfitProduct[]>("profitable_products")) ?? [];
  if (!Array.isArray(products) || products.length === 0) return [];
  const listingRate = new Map<string, number>(
    products.map(applyDisplayProfit).map((p) => [p.id, p.realProfitRate ?? 0])
  );
  const soldJudged = (await applySoldComp(products)).map(applyDisplayProfit);
  const over = new Map<string, { rateListing: number; rateSold: number }>();
  for (const p of soldJudged) {
    const rateSold = p.realProfitRate ?? 0;
    const rateListing = listingRate.get(p.id) ?? 0;
    if (p.soldBased && rateSold < FLOOR && rateListing >= FLOOR) {
      over.set(p.id, { rateListing, rateSold });
    }
  }
  if (over.size === 0) return [];

  const targets: Target[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await kvReadOnly.scan(cursor, { match: "ebay_deals:*", count: 200 });
    cursor = String(next);
    for (const key of keys as string[]) {
      const conn = key.slice("ebay_deals:".length);
      const deals = (await kvReadOnly.hgetall<Record<string, Deal>>(key)) ?? {};
      for (const [pid, d] of Object.entries(deals)) {
        if (!d || d.stoppedAt || d.soldAt || !d.sku) continue; // 出品中で SKU があるものだけ
        const o = over.get(pid);
        if (!o) continue;
        targets.push({ conn, productId: pid, sku: d.sku, title: String(d.title ?? "").slice(0, 60), listingId: d.listingId, ...o });
      }
    }
  } while (cursor !== "0");
  return targets;
}

export async function GET() {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const targets = await findTargets();
  return Response.json({ ok: true, count: targets.length, targets });
}

export async function POST() {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const targets = await findTargets();
  const results: Array<Target & { ok: boolean; ended?: boolean; error?: string }> = [];
  for (const t of targets) {
    const token = await getValidAccessToken(t.conn);
    if (!token) { results.push({ ...t, ok: false, error: "トークン取得失敗" }); continue; }
    const r = await withdrawListingForSku(token, t.sku);
    if (r.ok) {
      await markStopped(t.conn, t.productId);
      results.push({ ...t, ok: true, ended: r.ended });
    } else {
      results.push({ ...t, ok: false, error: r.error });
    }
  }
  return Response.json({ ok: true, total: targets.length, stopped: results.filter((r) => r.ok).length, results });
}
