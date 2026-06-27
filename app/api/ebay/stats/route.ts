import { getDataActor } from "../../../lib/auth/teamActor";
import { getStats } from "../../../lib/ebay/stats";

// マイページの収益集計。チーム参加中は共有データ（オーナー名前空間）の収益を全員で見る。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getDataActor();
  if (!actor) return Response.json({ ok: false });
  const stats = await getStats(actor);
  return Response.json({ ok: true, stats }, { headers: { "Cache-Control": "private, no-store" } });
}
