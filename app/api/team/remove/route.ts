import { getActorId } from "../../../lib/auth/actor";
import { removeMember, cancelInvite, setTeamName, setTeamMode, setMemberPerms, hasPerm } from "../../../lib/team";

// チームの操作：オーナーがメンバー除名 / メンバーが離脱 / オーナーが保留中招待を取消。
// 権限：
//   set-name / set-mode / set-perms はオーナー本人(caller===owner)のみ＝昇格防止のため委譲不可。
//   remove-member / cancel-invite は ownerActor を指定して委譲可（manage 権限保持者のみ・オーナー本人は除名不可）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, error: "ログインしてください。" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string; ownerActor?: string; memberActor?: string; email?: string; name?: string; mode?: string; perms?: string[];
  };
  const action = body.action;

  // 委譲解決：ownerActor 省略/自分なら自分のチーム。別オーナーなら manage 権限が必要（無ければ 403）。
  // set-* 系では使わない（オーナー専用）。null=権限なしで拒否。
  const resolveTeamOwner = async (): Promise<string | null> => {
    const reqOwner = (body.ownerActor || "").trim();
    if (!reqOwner || reqOwner === actor) return actor;
    return (await hasPerm(reqOwner, actor, "manage")) ? reqOwner : null;
  };

  try {
    if (action === "set-name") {
      // オーナー本人だけが自分のチーム名を設定（空なら解除）。委譲不可。
      await setTeamName(actor, body.name || "");
      return Response.json({ ok: true });
    }
    if (action === "set-mode") {
      // オーナー本人だけが自分のチームの方式（共有/個別）を設定。委譲不可。
      await setTeamMode(actor, body.mode === "shared" ? "shared" : "individual");
      return Response.json({ ok: true });
    }
    if (action === "set-perms") {
      // オーナー本人だけがメンバーの権限を設定（昇格防止のため委譲不可）。
      if (!body.memberActor || !Array.isArray(body.perms)) return Response.json({ ok: false, error: "対象/権限がありません。" }, { status: 400 });
      await setMemberPerms(actor, body.memberActor, body.perms);
      return Response.json({ ok: true });
    }
    if (action === "remove-member") {
      // オーナー本人 or manage 権限保持者が、対象オーナーのチームから除名できる。オーナー本人は除名不可。
      if (!body.memberActor) return Response.json({ ok: false, error: "対象がありません。" }, { status: 400 });
      const owner = await resolveTeamOwner();
      if (!owner) return Response.json({ ok: false, error: "このチームを管理する権限がありません。" }, { status: 403 });
      if (body.memberActor === owner) return Response.json({ ok: false, error: "オーナーは外せません。" }, { status: 400 });
      await removeMember(owner, body.memberActor);
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
      // オーナー本人 or manage 権限保持者が、対象オーナーの保留中招待を取消。
      if (!body.email) return Response.json({ ok: false, error: "対象がありません。" }, { status: 400 });
      const owner = await resolveTeamOwner();
      if (!owner) return Response.json({ ok: false, error: "このチームを管理する権限がありません。" }, { status: 403 });
      await cancelInvite(owner, body.email);
      return Response.json({ ok: true });
    }
  } catch {
    return Response.json({ ok: false, error: "操作に失敗しました。" }, { status: 503 });
  }
  return Response.json({ ok: false, error: "不明な操作です。" }, { status: 400 });
}
