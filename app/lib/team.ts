// チーム共有：オーナーが会員を招待→承認で、オーナーの「仕入れ一覧＋収支」を読み取り専用で共有する。
// サーバー専用。Supabase service役鍵は不要＝招待はメール宛、承認時に本人(ログイン)のactorを確定して名簿に入れる。
// KV:
//  team_invite:{token}   = {ownerActor, ownerEmail, inviteeEmail, createdAt}  招待トークン(TTL7日・本人がリンクで承認)
//  team_roster:{owner}   = Hash {memberActor: memberEmail}  オーナーのチーム名簿(承認済み)
//  team_of:{member}      = Hash {ownerActor: ownerEmail}    そのメンバーが閲覧できるチーム(逆引き)
//  team_pending:{owner}  = Hash {inviteeEmail: token}       オーナーの保留中招待(表示/重複防止/取消用)
import { kv } from "@vercel/kv";
import crypto from "node:crypto";

export type TeamInvite = { ownerActor: string; ownerEmail: string; inviteeEmail: string; createdAt: string };
export type RosterMember = { actor: string; email: string };
export type TeamRef = { ownerActor: string; ownerEmail: string };

const INVITE_KEY = (t: string) => `team_invite:${t}`;
const ROSTER_KEY = (owner: string) => `team_roster:${owner}`;
const TEAMS_OF_KEY = (member: string) => `team_of:${member}`;
const PENDING_KEY = (owner: string) => `team_pending:${owner}`;
const INVITE_TTL = 7 * 24 * 60 * 60; // 招待は7日で失効
const norm = (e: string) => (e || "").trim().toLowerCase();

// 招待を作成（トークン発行＋保留中に登録）。token を返す。既に保留中なら既存トークンを再利用しない（新規発行で上書き）。
export async function createInvite(ownerActor: string, ownerEmail: string, inviteeEmail: string): Promise<string> {
  const token = crypto.randomUUID();
  const inv: TeamInvite = { ownerActor, ownerEmail: norm(ownerEmail), inviteeEmail: norm(inviteeEmail), createdAt: new Date().toISOString() };
  await kv.set(INVITE_KEY(token), inv, { ex: INVITE_TTL });
  try {
    await kv.hset(PENDING_KEY(ownerActor), { [norm(inviteeEmail)]: token });
    await kv.expire(PENDING_KEY(ownerActor), INVITE_TTL);
  } catch { /* noop */ }
  return token;
}

export async function getInvite(token: string): Promise<TeamInvite | null> {
  if (!token) return null;
  try {
    const inv = await kv.get<TeamInvite>(INVITE_KEY(token));
    return inv && inv.ownerActor && inv.inviteeEmail ? inv : null;
  } catch {
    return null;
  }
}

// 承認＝本人(viewer)のactor/emailで名簿に入れる。viewerのメールが招待先と一致しなければ拒否。
export async function acceptInvite(
  token: string,
  viewerActor: string,
  viewerEmail: string
): Promise<{ ok: true; team: TeamRef } | { ok: false; error: string }> {
  const inv = await getInvite(token);
  if (!inv) return { ok: false, error: "招待が見つからないか期限切れです。" };
  if (norm(viewerEmail) !== norm(inv.inviteeEmail)) {
    return { ok: false, error: `この招待は ${inv.inviteeEmail} 宛です。そのアカウントでログインしてください。` };
  }
  if (viewerActor === inv.ownerActor) return { ok: false, error: "自分のチームには参加できません。" };
  try {
    await kv.hset(ROSTER_KEY(inv.ownerActor), { [viewerActor]: norm(viewerEmail) });
    await kv.hset(TEAMS_OF_KEY(viewerActor), { [inv.ownerActor]: inv.ownerEmail });
    await kv.hdel(PENDING_KEY(inv.ownerActor), norm(inv.inviteeEmail));
    await kv.del(INVITE_KEY(token)); // トークン消費
  } catch {
    return { ok: false, error: "承認の保存に失敗しました。少し待って再度お試しください。" };
  }
  return { ok: true, team: { ownerActor: inv.ownerActor, ownerEmail: inv.ownerEmail } };
}

// オーナーのチーム名簿（承認済みメンバー）。
export async function getRoster(ownerActor: string): Promise<RosterMember[]> {
  try {
    const map = (await kv.hgetall<Record<string, string>>(ROSTER_KEY(ownerActor))) ?? {};
    return Object.entries(map).map(([actor, email]) => ({ actor, email: String(email) }));
  } catch {
    return [];
  }
}

// オーナーの保留中招待（未承認）。
export async function getPending(ownerActor: string): Promise<{ email: string; token: string }[]> {
  try {
    const map = (await kv.hgetall<Record<string, string>>(PENDING_KEY(ownerActor))) ?? {};
    return Object.entries(map).map(([email, token]) => ({ email, token: String(token) }));
  } catch {
    return [];
  }
}

// そのメンバーが閲覧できるチーム一覧（逆引き）。
export async function getMyTeams(memberActor: string): Promise<TeamRef[]> {
  try {
    const map = (await kv.hgetall<Record<string, string>>(TEAMS_OF_KEY(memberActor))) ?? {};
    return Object.entries(map).map(([ownerActor, ownerEmail]) => ({ ownerActor, ownerEmail: String(ownerEmail) }));
  } catch {
    return [];
  }
}

// viewer が owner のチームを閲覧できるか（オーナー本人 or 名簿メンバー）。共有データの権限ゲート。
export async function isTeamMember(viewerActor: string | undefined | null, ownerActor: string): Promise<boolean> {
  if (!viewerActor || !ownerActor) return false;
  if (viewerActor === ownerActor) return true;
  try {
    return (await kv.hexists(ROSTER_KEY(ownerActor), viewerActor)) === 1;
  } catch {
    return false;
  }
}

// メンバーを外す（オーナーが除名 or メンバーが離脱、両方向の索引を消す）。
export async function removeMember(ownerActor: string, memberActor: string): Promise<void> {
  try {
    await kv.hdel(ROSTER_KEY(ownerActor), memberActor);
    await kv.hdel(TEAMS_OF_KEY(memberActor), ownerActor);
  } catch { /* noop */ }
}

// 保留中招待を取り消す。
export async function cancelInvite(ownerActor: string, inviteeEmail: string): Promise<void> {
  const e = norm(inviteeEmail);
  try {
    const token = await kv.hget<string>(PENDING_KEY(ownerActor), e);
    if (token) await kv.del(INVITE_KEY(token));
    await kv.hdel(PENDING_KEY(ownerActor), e);
  } catch { /* noop */ }
}
