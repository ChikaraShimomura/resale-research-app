import { cookies } from "next/headers";
import { getStats } from "../../../lib/ebay/stats";

// 「育てるダッシュボード」用の集計（端末単位）。KVのみ参照・eBayは叩かない。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ok: false });
  const stats = await getStats(actor);
  return Response.json({ ok: true, stats }, { headers: { "Cache-Control": "private, no-store" } });
}
