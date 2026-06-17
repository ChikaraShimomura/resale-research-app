import { getActorId } from "../../../lib/auth/actor";
import { saveSubscription, updatePrefs, removeSubscription, getPrefsForActor, DEFAULT_PREFS, PushPrefs, WebPushSub } from "../../../lib/push";

// プッシュ購読の登録・設定更新・解除。アカウント(actor)単位で保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: この actor の通知設定（設定UIの初期表示用）。購読が無ければ enabled=false。
export async function GET() {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, enabled: false }, { headers: { "Cache-Control": "private, no-store" } });
  const prefs = await getPrefsForActor(actor);
  return Response.json({ ok: true, enabled: !!prefs, prefs: prefs ?? DEFAULT_PREFS }, { headers: { "Cache-Control": "private, no-store" } });
}

// POST: { action: "subscribe"|"prefs"|"unsubscribe", subscription?, endpoint?, prefs? }
export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    subscription?: WebPushSub;
    endpoint?: string;
    prefs?: PushPrefs;
  };

  if (body.action === "unsubscribe") {
    if (body.endpoint) await removeSubscription(body.endpoint);
    return Response.json({ ok: true });
  }
  if (body.action === "prefs") {
    if (body.endpoint && body.prefs) await updatePrefs(actor, body.endpoint, body.prefs);
    return Response.json({ ok: true });
  }
  // 既定: 購読登録（prefs 未指定は全部ON）。
  if (body.subscription?.endpoint) {
    await saveSubscription(actor, body.subscription, body.prefs ?? DEFAULT_PREFS);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: "invalid" }, { status: 400 });
}
