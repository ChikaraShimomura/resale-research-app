import { kv } from "@vercel/kv";
import { reconcileActorStops } from "../../../../lib/ebay/sourceReconcile";

// cron用：全アクターを走査し、仕入れ元が売切/リンク切れの出品をeBayから自動停止する。
// 検知(checkListings.mjs)が deal.sourceStatus を立てた直後に、check-listings ワークフローから呼ばれる。
// 離席中でも~30分以内に自動停止＝欠品キャンセル防止。CRON_SECRET で保護。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  // 認証：Authorization: Bearer <CRON_SECRET> か ?secret=。未設定なら拒否(フェイルクローズ)。
  // 全アクターの出品を取り下げる破壊的cronなので、設定漏れ時に無認可で動かさない。
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization");
  if (!secret || (bearer !== `Bearer ${secret}` && url.searchParams.get("secret") !== secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ebay_deals:* を走査してアクター一覧を作る。
  const actors: string[] = [];
  let cursor = "0";
  let guard = 0;
  do {
    const res: [string | number, string[]] = await kv.scan(cursor, { match: "ebay_deals:*", count: 200 });
    cursor = String(res[0]);
    for (const k of res[1]) actors.push(String(k).slice("ebay_deals:".length));
  } while (cursor !== "0" && ++guard < 1000);

  let totalStopped = 0;
  for (const actor of actors) {
    try {
      const s = await reconcileActorStops(actor);
      totalStopped += s.length;
    } catch {
      /* 1アクターの失敗で全体を止めない */
    }
  }
  return Response.json({ ok: true, actors: actors.length, stopped: totalStopped });
}
