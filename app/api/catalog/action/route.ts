import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getActorId } from "../../../lib/auth/actor";

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

// POST: { action: "bought"|"skip"|"undo", productId }
export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false }, { status: 401 });
  try {
    const { success } = await rl.limit(actor);
    if (!success) return Response.json({ ok: false, error: "しばらくしてからお試しください。" }, { status: 429 });
  } catch { /* フェイルオープン */ }

  const body = (await req.json().catch(() => ({}))) as { action?: string; productId?: string };
  const productId = (body.productId || "").trim();
  if (!productId || productId.length > 256) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  try {
    if (body.action === "bought") {
      // 仕入れた＝スキップとは排他。仕入れ集合へ入れ、スキップからは外す。
      await kv.sadd(BOUGHT_KEY(actor), productId);
      await kv.srem(SKIP_KEY(actor), productId);
      await kv.expire(BOUGHT_KEY(actor), BOUGHT_TTL);
      return Response.json({ ok: true });
    }
    if (body.action === "skip") {
      await kv.sadd(SKIP_KEY(actor), productId);
      await kv.srem(BOUGHT_KEY(actor), productId);
      await kv.expire(SKIP_KEY(actor), SKIP_TTL);
      return Response.json({ ok: true });
    }
    if (body.action === "undo") {
      // どちらの印も解除＝カタログに戻す。
      await kv.srem(BOUGHT_KEY(actor), productId);
      await kv.srem(SKIP_KEY(actor), productId);
      return Response.json({ ok: true });
    }
  } catch {
    return Response.json({ ok: false, error: "保存できませんでした。少し待ってお試しください。" }, { status: 503 });
  }

  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
