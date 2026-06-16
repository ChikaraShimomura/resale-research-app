import { kv } from "@vercel/kv";
import { getActorId } from "../../../lib/auth/actor";
import { listDealsForUser, removeDeal, recordSold, USD_JPY } from "../../../lib/ebay/stats";
import { SKU_MAP_KEY } from "../../../lib/ebay/listing";
import { skuForProduct } from "../../../lib/ebay/sellApi";

// マイページ「出品中の商品」の一覧と手動調整（出品をやめた／実は売れていた）。
// 端末(アクター)単位の KV ハッシュ ebay_deals を読み書きする。eBay は叩かない。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOLD_KEY = (actor: string) => `ebay_sold:${actor}`;
const SOLD_TTL = 180 * 24 * 60 * 60; // sold/route.ts と一致（最終更新から180日）

// GET: 出品中（未売却）と輸出した（売却済み）の取引一覧。
export async function GET() {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, live: [], sold: [] });
  const { live, sold } = await listDealsForUser(actor);
  return Response.json({ ok: true, live, sold }, { headers: { "Cache-Control": "private, no-store" } });
}

// POST: { action: "remove" | "sold", productId, soldJpy? }
export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    productId?: string;
    soldJpy?: number;
  };
  const productId = (body.productId || "").trim();
  if (!productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  // 出品をやめた → 成績から削除。売却検知の逆引き(SKU)も消し、後から売却扱いされないようにする。
  if (body.action === "remove") {
    await removeDeal(actor, productId);
    try {
      await kv.hdel(SKU_MAP_KEY(actor), skuForProduct(productId));
    } catch {
      /* noop */
    }
    return Response.json({ ok: true });
  }

  // 実は売れていた（自動検知の取りこぼし）→ 売れた金額(円)で手動記録。
  if (body.action === "sold") {
    const jpy = Number(body.soldJpy);
    if (!Number.isFinite(jpy) || jpy <= 0) {
      return Response.json({ ok: false, error: "売れた金額（円）を入力してください。" }, { status: 400 });
    }
    const soldUsd = Math.round((jpy / USD_JPY) * 100) / 100; // 表示は円ベース・保存はUSD（statsが×155で円に戻す）
    await recordSold(actor, productId, soldUsd, new Date().toISOString());
    // カタログ表示（売却済み・最下部化）も自動検知と一致させる。
    try {
      await kv.sadd(SOLD_KEY(actor), productId);
      await kv.expire(SOLD_KEY(actor), SOLD_TTL);
    } catch {
      /* noop */
    }
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
