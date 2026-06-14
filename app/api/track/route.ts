import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { cookies, headers } from "next/headers";
import { FUNNEL_EVENTS, FUNNEL_TTL, jstDate, evcKey, evuKey } from "../../lib/funnel";

// 行動ログ（離脱分析用）。ファネルの各イベントを「日次」で集計する。
// キー設計とイベント定義は app/lib/funnel.ts に一元化（/api/report/weekly と共有）。
// 個人を特定する生ログは保存しない（端末cookieのみ）。100日で自動失効。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set<string>(FUNNEL_EVENTS);

const rl = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(150, "10 m"),
  prefix: "rl:track:ip",
  analytics: false,
});

function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
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
      kv.incr(evcKey(date, event)),
      kv.expire(evcKey(date, event), FUNNEL_TTL),
      kv.sadd(evuKey(date, event), actor),
      kv.expire(evuKey(date, event), FUNNEL_TTL),
    ]);
  } catch {
    /* 集計失敗は黙って捨てる（ユーザー体験を妨げない） */
  }
  return new Response(null, { status: 204 });
}
