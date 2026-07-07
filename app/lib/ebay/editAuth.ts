// 出品の編集系API（価格/数量/件名/説明/送料/写真）共通の認可＋アクター解決。
// 共有モードではオーナーのeBay/在庫を直接書き換えるため、権限の無いチームメンバーが勝手に
// 値下げ/件名改変/写真差し替えできないよう、メンバー操作には 'list' 権限を要求する（publish と同じ認可軸）。
// 返り値の actor は対象のeBayアカウント（共有=オーナー / 個別=本人）。deny があれば呼び出し側はそのまま返す。
import { getTeamContext } from "../auth/teamActor";
import { hasPerm } from "../team";
import { canAutoList } from "../auth/plan";

export async function resolveEditAuth(): Promise<{ actor: string } | { deny: Response }> {
  const { viewer, ebayActor, owner, isMember } = await getTeamContext();
  if (!viewer) return { deny: Response.json({ ok: false, connected: false }) };
  const teamOp = isMember && !!owner && owner !== viewer; // 他人(オーナー)のチームに参加しているメンバーの操作
  if (teamOp && owner && !(await hasPerm(owner, viewer, "list"))) {
    return { deny: Response.json({ ok: false, error: "このチームでの出品の編集権限がありません。" }, { status: 403 }) };
  }
  // ★出品の編集(価格/件名/説明/写真)も出品操作＝有料プラン(ライト以上)限定。閲覧(viewer)/未購読(free)は不可。
  //   チーム操作(teamOp)はオーナーが権限付与済み＝認可なのでプラン判定はスキップ(publishと同じ軸)。
  if (!teamOp && !(await canAutoList())) {
    return { deny: Response.json({ ok: false, needsPlan: true, error: "この操作にはeBay出品プラン（ライト以上）が必要です。" }, { status: 403 }) };
  }
  return { actor: ebayActor ?? viewer };
}
