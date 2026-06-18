import { getActorId } from "../../../../lib/auth/actor";
import { reconcileActorStops, getPendingRecap, clearRecap } from "../../../../lib/ebay/sourceReconcile";

// アプリを開いたとき：本人(セッションactor)の出品で仕入れ元が売切/リンク切れのものを自動停止し、
// 未確認の自動停止recap（モーダル表示用）を返す。{ack:true} で確認済み＝recapをクリア。
// 離席中ぶんは check-listings cron → auto-stop-cron が同じ処理をするので、ここは「開いた瞬間も即停止」用。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: true, pending: [] }); // 未ログインは何もしない

  const body = (await req.json().catch(() => ({}))) as { ack?: boolean };
  if (body.ack) {
    await clearRecap(actor);
    return Response.json({ ok: true });
  }

  try {
    await reconcileActorStops(actor); // 開いた瞬間に未処理ぶんを停止
  } catch {
    /* 停止に失敗しても recap 表示は続ける */
  }
  const pending = await getPendingRecap(actor);
  return Response.json({ ok: true, pending });
}
