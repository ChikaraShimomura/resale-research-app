import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { cookies, headers } from "next/headers";

// 行動ログ（離脱分析用）。ファネルの各イベントを「日次」で集計する。
// evc:{JST日付}:{event} = 回数(INCR)、evu:{JST日付}:{event} = ユニーク端末数(SADD rr_did)。
// 個人を特定する生ログは保存しない（端末cookieのみ）。100日で自動失効。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 受け付けるイベント名（タイポ・濫用での無限キー生成を防ぐallowlist）
export const FUNNEL_EVENTS = [
  "visit",
  "search",
  "results_view",
  "product_view",
  "rakuten_buy",
  "listing_open",
  "listed",
  "sold",
] as const;
const ALLOWED = new Set<string>(FUNNEL_EVENTS);
const TTL = 100 * 24 * 60 * 60;

const rl = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(150, "10 m"),
  prefix: "rl:track:ip",
  analytics: false,
});

function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
}

// 集計の日付キーは日本時間（ユーザーは日本在住・レポートもJST基準）。
function jstDate(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  let event = "";
  try {
    event = ((await req.json()) as { event?: string })?.event ?? "";
  } catch {
    /* sendBeacon等で本文が取れない場合は無視 */
  }
  if (!ALLOWED.has(event)) return new Response(null, { status: 204 });

  // レート制限（KV障害時はフェイルオープン）
  try {
    const h = await headers();
    const { success } = await rl.limit(clientIp(h));
    if (!success) return new Response(null, { status: 204 });
  } catch {
    /* フェイルオープン */
  }

  const date = jstDate();
  const actor = (await cookies()).get("rr_did")?.value || "anon";
  try {
    await Promise.all([
      kv.incr(`evc:${date}:${event}`),
      kv.expire(`evc:${date}:${event}`, TTL),
      kv.sadd(`evu:${date}:${event}`, actor),
      kv.expire(`evu:${date}:${event}`, TTL),
    ]);
  } catch {
    /* 集計失敗は黙って捨てる（ユーザー体験を妨げない） */
  }
  return new Response(null, { status: 204 });
}
