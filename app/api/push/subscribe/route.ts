import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getActorId } from "../../../lib/auth/actor";
import { saveSubscription, updatePrefs, removeSubscription, getPrefsForActor, DEFAULT_PREFS, PushPrefs, WebPushSub } from "../../../lib/push";

// プッシュ購読の登録・設定更新・解除。アカウント(actor)単位で保存。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 濫用防止: 1アクター30回/10分。ユニークendpointを大量登録して共有hash(push_subs)を肥大化させるのを防ぐ。
const rl = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(30, "10 m"), prefix: "rl:push:actor", analytics: false });

// endpoint は https の URL かつ妥当長のみ受理（攻撃者制御の任意文字列がhashキーになるのを防ぐ）。
function validEndpoint(e?: string): e is string {
  if (!e || typeof e !== "string" || e.length > 1024) return false;
  try { return new URL(e).protocol === "https:"; } catch { return false; }
}

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
  // レート制限（KV障害時はフェイルオープン）。
  try {
    const { success } = await rl.limit(actor);
    if (!success) return Response.json({ ok: false, error: "しばらくしてからお試しください。" }, { status: 429 });
  } catch { /* フェイルオープン */ }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    subscription?: WebPushSub;
    endpoint?: string;
    prefs?: PushPrefs;
  };

  if (body.action === "unsubscribe") {
    if (validEndpoint(body.endpoint)) await removeSubscription(body.endpoint, actor); // 本人の購読のみ解除
    return Response.json({ ok: true });
  }
  if (body.action === "prefs") {
    if (validEndpoint(body.endpoint) && body.prefs) await updatePrefs(actor, body.endpoint, body.prefs);
    return Response.json({ ok: true });
  }
  // 既定: 購読登録（prefs 未指定は全部ON）。
  if (validEndpoint(body.subscription?.endpoint)) {
    await saveSubscription(actor, body.subscription!, body.prefs ?? DEFAULT_PREFS);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, error: "invalid" }, { status: 400 });
}
