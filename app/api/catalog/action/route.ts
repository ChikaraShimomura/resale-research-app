import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getActorId } from "../../../lib/auth/actor";
import { fetchSourceAvailability } from "../../../lib/usedGallery";

// 中古カタログの「仕入れた」「これは無理(スキップ)」印。アクター単位の集合に記録し、カタログ/ランキングの表示から外す。
// eBay もカタログ生成も叩かない。ログイン時は actor=acct:{uuid} なので別端末でも同じ印が効く。
// 1点物なので「仕入れた」はそのユーザーにとっての売り切れ印にもなる（本人が再表示したい時は undo）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOUGHT_KEY = (actor: string) => `used_bought:${actor}`;
const SKIP_KEY = (actor: string) => `used_skip:${actor}`;
const BOUGHT_TTL = 365 * 24 * 60 * 60; // 仕入れ実績は長め(1年)
const SKIP_TTL = 180 * 24 * 60 * 60; // スキップ判断は半年で自然解除（気が変われば再表示）

// 濫用防止: 書き込みは1アクター60回/10分。大量IDをaddして集合を肥大化させるのを防ぐ。
const rl = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(60, "10 m"), prefix: "rl:catalogact:actor", analytics: false });

// POST: { action: "bought"|"skip"|"undo", productId, buyJpy? }
// used_bought は「id→仕入れ値(JPY)」のハッシュ＝収支の仕入れ累計に使う。used_skip は id の集合（金額不要）。
export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false }, { status: 401 });
  try {
    const { success } = await rl.limit(actor);
    if (!success) return Response.json({ ok: false, error: "しばらくしてからお試しください。" }, { status: 429 });
  } catch { /* フェイルオープン */ }

  const body = (await req.json().catch(() => ({}))) as { action?: string; productId?: string; buyJpy?: number; shippingJpy?: number };
  const productId = (body.productId || "").trim();
  if (!productId || productId.length > 256) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });
  // 仕入れ値は0〜1億円に丸めて保存（異常値で集計を壊さない）。未指定/不正は0（印は付くが金額なし）。
  const buyJpy = Math.min(Math.max(0, Math.round(Number(body.buyJpy) || 0)), 100_000_000);

  try {
    if (body.action === "bought") {
      // 仕入れた＝スキップとは排他。「仕入れ商品一覧」で出品できるよう、psnap(出品用ProfitProduct)のスナップショットを丸ごと保存。
      // 金額(buyJpy)は finance(getStats) 用に上位にも持つ。psnap が無い古い品はクライアント送信の buyJpy で最小記録。
      let snap = null;
      try { snap = await kv.get(`psnap:${productId}`); } catch { /* noop */ }
      const item =
        snap && typeof snap === "object"
          ? { ...(snap as Record<string, unknown>), buyJpy: Number((snap as { source?: { price?: number } }).source?.price) || buyJpy, boughtAt: new Date().toISOString() }
          : { id: productId, buyJpy, boughtAt: new Date().toISOString() };
      await kv.hset(BOUGHT_KEY(actor), { [productId]: item });
      await kv.srem(SKIP_KEY(actor), productId);
      await kv.expire(BOUGHT_KEY(actor), BOUGHT_TTL);
      // 出品は後日でも動くよう psnap を仕入れTTLまで延命（既定TTL35日で失効すると prepare が引けなくなるため）。
      if (snap && typeof snap === "object") { try { await kv.set(`psnap:${productId}`, snap, { ex: BOUGHT_TTL }); } catch { /* noop */ } }
      // 在庫確認：仕入れ元がまだ「在庫あり」なら無在庫転売の疑い→クライアントで注意喚起＋プロMAX誘導。Hard Offのみ判定可。
      let availability: "in-stock" | "sold-out" | "unknown" = "unknown";
      try {
        const srcUrl = snap && typeof snap === "object" ? String((snap as { source?: { url?: string } }).source?.url || "") : "";
        if (srcUrl) availability = await fetchSourceAvailability(srcUrl);
      } catch { /* noop */ }
      return Response.json({ ok: true, availability });
    }
    if (body.action === "skip") {
      await kv.sadd(SKIP_KEY(actor), productId);
      await kv.hdel(BOUGHT_KEY(actor), productId);
      await kv.expire(SKIP_KEY(actor), SKIP_TTL);
      return Response.json({ ok: true });
    }
    if (body.action === "undo") {
      // どちらの印も解除＝カタログに戻す。送料設定も消す。
      await kv.hdel(BOUGHT_KEY(actor), productId);
      await kv.srem(SKIP_KEY(actor), productId);
      try { await kv.hdel(`used_ship:${actor}`, productId); } catch { /* noop */ }
      return Response.json({ ok: true });
    }
    if (body.action === "shipping") {
      // 仕入れた商品の送料（円）を保存。未設定の品は集計時に一律1000円扱い。0〜10万に丸める。
      const shippingJpy = Math.min(100000, Math.max(0, Math.round(Number(body.shippingJpy) || 0)));
      await kv.hset(`used_ship:${actor}`, { [productId]: shippingJpy });
      await kv.expire(`used_ship:${actor}`, BOUGHT_TTL);
      return Response.json({ ok: true, shippingJpy });
    }
  } catch {
    return Response.json({ ok: false, error: "保存できませんでした。少し待ってお試しください。" }, { status: 503 });
  }

  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
