import { kvReadOnly } from "../../../lib/kv";

// 住宅IPワーカー（楽天の売切/削除検知）の鮮度を返す。UIで「在庫の自動チェックが止まっている」かを判定する用。
// liveness_last_real_run は sourceLivenessWorker が「実検査が成立した時だけ」更新する＝この鮮度が落ちる＝検知が遅れている。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_HOURS = 6; // 売切検知ワーカーは毎時想定。これ以上 実検査が無ければ stale。

export async function GET() {
  try {
    const r = await kvReadOnly.get<{ at?: string }>("liveness_last_real_run");
    const at = r?.at ? Date.parse(r.at) : NaN;
    // 未記録（一度も成立してない）はアラームを出さない＝誤警告回避（fail-safe）。本物の停止は3hの死活メールが拾う。
    if (!Number.isFinite(at)) {
      return Response.json({ fresh: true, ageHours: null, unknown: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const ageHours = Math.round(((Date.now() - at) / 3_600_000) * 10) / 10;
    return Response.json({ fresh: ageHours <= STALE_HOURS, ageHours }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ fresh: true, ageHours: null, unknown: true }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
