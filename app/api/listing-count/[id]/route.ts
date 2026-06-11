import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { cookies, headers } from "next/headers";

// SOLD（eBay乱立防止）の出品カウント。
// 旧実装はグローバル整数 INCR で、認証なし・冪等性なしのため競合が数百回 POST するだけで
// 全商品を「出品上限」に偽装できる妨害攻撃が可能だった。
// → アクター単位の SET（SADD/SCARD）に変更。実際に出品した「異なるデバイス数」を数え、
//   1アクターは何度押してもカウント +0。さらにレート制限・id検証・90日TTL自動リセットを追加。

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9:_.\-]{1,128}$/;
const ACTOR_KEY = (id: string) => `listing_actors:${id}`;
const TTL_SECONDS = 90 * 24 * 60 * 60; // 最終アクションから90日で自動リセット

// レート制限（@upstash/ratelimit は @vercel/kv をそのまま利用）。
// 商品×IP と IP全体 の二段で spray を抑える。
const rlPerProduct = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(5, "10 m"),
  prefix: "rl:lc:prod",
  analytics: false,
});
const rlPerIp = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  prefix: "rl:lc:ip",
  analytics: false,
});

function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
}

async function scard(id: string): Promise<number> {
  try {
    return (await kv.scard(ACTOR_KEY(id))) ?? 0;
  } catch {
    return 0;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!ID_RE.test(id)) return Response.json({ count: 0 }, { status: 400 });
  const count = await scard(id);
  return Response.json({ count }, { headers: { "Cache-Control": "private, max-age=30" } });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // 不正な id で任意の KV キーを膨らませる攻撃を防ぐ
  if (!ID_RE.test(id)) return new Response("bad id", { status: 400 });

  const h = await headers();
  const ip = clientIp(h);

  // レート制限（KV障害時はフェイルオープンして可用性を優先。SET側の冪等性が下支えする）
  try {
    const [p, g] = await Promise.all([
      rlPerProduct.limit(`${ip}:${id}`),
      rlPerIp.limit(ip),
    ]);
    if (!p.success || !g.success) {
      return new Response("rate limited", { status: 429 });
    }
  } catch {
    /* フェイルオープン */
  }

  // 暫定アクター識別子（middleware が発行する HttpOnly デバイス cookie）。
  // 本来の認証が入ったら userId に置き換える。
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) {
    return Response.json({ count: await scard(id) });
  }

  try {
    await kv.sadd(ACTOR_KEY(id), actor); // 冪等：同一アクターの連打・リトライは無害
    await kv.expire(ACTOR_KEY(id), TTL_SECONDS);
    return Response.json({ count: await scard(id) });
  } catch {
    return Response.json({ count: 0 });
  }
}
