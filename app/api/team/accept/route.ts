import { getActorId } from "../../../lib/auth/actor";
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { acceptInvite } from "../../../lib/team";
import { recordRegisteredUser } from "../../../lib/auth/admin";

// チーム招待の承認。本人(ログイン中)のactor/emailで名簿に入る。emailが招待先と一致しないと拒否。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await getActorId();
  const email = await getCurrentUserEmail();
  if (!actor || !email) return Response.json({ ok: false, error: "ログインしてください。" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = (body.token || "").trim();
  if (!token) return Response.json({ ok: false, error: "招待トークンがありません。" }, { status: 400 });

  const res = await acceptInvite(token, actor, email);
  if (!res.ok) return Response.json(res, { status: 400 });
  // 承認した本人は確実に会員＝会員集合に記録（registered_users を育てて今後の会員判定の取りこぼしを減らす）。
  try { await recordRegisteredUser(email); } catch { /* noop */ }
  return Response.json(res);
}
