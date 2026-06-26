import { getActorId } from "../../../lib/auth/actor";
import { removeMember, cancelInvite, setTeamName } from "../../../lib/team";

// チームの操作：オーナーがメンバー除名 / メンバーが離脱 / オーナーが保留中招待を取消。
// 権限：除名・取消はオーナー本人(ownerActor===自分)のみ。離脱は自分(viewer)を ownerActor のチームから外す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, error: "ログインしてください。" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; ownerActor?: string; memberActor?: string; email?: string; name?: string };
  const action = body.action;

  try {
    if (action === "set-name") {
      // オーナーが自分のチーム名を設定（空なら解除）。
      await setTeamName(actor, body.name || "");
      return Response.json({ ok: true });
    }
    if (action === "remove-member") {
      // オーナー本人だけが自分のチームから除名できる。
      if (!body.memberActor) return Response.json({ ok: false, error: "対象がありません。" }, { status: 400 });
      await removeMember(actor, body.memberActor);
      return Response.json({ ok: true });
    }
    if (action === "leave") {
      // メンバーが自分を ownerActor のチームから外す。
      const owner = (body.ownerActor || "").trim();
      if (!owner) return Response.json({ ok: false, error: "対象チームがありません。" }, { status: 400 });
      await removeMember(owner, actor);
      return Response.json({ ok: true });
    }
    if (action === "cancel-invite") {
      // オーナーが自分の保留中招待を取消。
      if (!body.email) return Response.json({ ok: false, error: "対象がありません。" }, { status: 400 });
      await cancelInvite(actor, body.email);
      return Response.json({ ok: true });
    }
  } catch {
    return Response.json({ ok: false, error: "操作に失敗しました。" }, { status: 503 });
  }
  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
