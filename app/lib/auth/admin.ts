// 管理者(admin)と身内(master)の判定・指定。サーバー専用。
// admin  = ADMIN_EMAILS（env・あなた）。/admin に入れて身内を指定できる。
// master = COMP_EMAILS（envの初期身内・編集不可）∪ KV集合 comp:masters（管理画面で追加/削除）。
// メールはソースに直書きせず env。公開リポジトリ対策。
import { kv } from "@vercel/kv";
import { supabaseAdminConfigured, listAllAuthUsers } from "../supabase/admin";

const MASTERS_KEY = "comp:masters"; // 身内メールのKV集合（管理画面で編集する分）
const REGISTERED_KEY = "registered_users"; // 登録/ログインしたメールの集合（身内指定の候補リスト用）

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ADMIN_EMAILS = envList("ADMIN_EMAILS");
const COMP_EMAILS = envList("COMP_EMAILS"); // 初期身内（env・UIからは消せない）

export function isAdmin(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// 身内（master）か。env初期身内 or KVで指定された身内。
export async function isMaster(email: string | null): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  if (COMP_EMAILS.includes(e)) return true;
  try {
    return (await kv.sismember(MASTERS_KEY, e)) === 1;
  } catch {
    return false;
  }
}

// 管理画面用：身内の一覧。env(消せない) と KV(消せる) を分けて返す。
export async function listMasters(): Promise<{ env: string[]; managed: string[] }> {
  let managed: string[] = [];
  try {
    managed = (await kv.smembers(MASTERS_KEY)) ?? [];
  } catch {
    /* KV障害時は空 */
  }
  return { env: COMP_EMAILS, managed: managed.sort() };
}

export async function addMaster(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) throw new Error("invalid_email");
  await kv.sadd(MASTERS_KEY, e);
}

export async function removeMaster(email: string): Promise<void> {
  await kv.srem(MASTERS_KEY, email.trim().toLowerCase());
}

// 登録/ログインしたユーザーのメールを候補リストに記録（身内指定UIで「登録済みユーザー」から選べるように）。
// サービスロール鍵を使わずに済むよう、認証成功時にここへ積む（冪等・失敗は無視）。
export async function recordRegisteredUser(email: string | null | undefined): Promise<void> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return;
  try {
    await kv.sadd(REGISTERED_KEY, e);
  } catch {
    /* 記録失敗は無視（候補に出ないだけ） */
  }
}

// 登録済みユーザー一覧（身内指定の候補）。
export async function listRegisteredUsers(): Promise<string[]> {
  try {
    return ((await kv.smembers(REGISTERED_KEY)) ?? []).sort();
  } catch {
    return [];
  }
}

// メールが「うちの会員」か（過去にログイン/登録した＝registered_usersに居る）。チーム招待の会員確認に使う。
// ※Supabase service役鍵が無くてもメール集合で判定できる。承認時に本人ログインで二重に担保するので、ここは早期UX判定。
export async function isRegisteredEmail(email: string | null | undefined): Promise<boolean> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return false;
  try {
    return (await kv.sismember(REGISTERED_KEY, e)) === 1;
  } catch {
    return false;
  }
}

// 会員確認（3段階）。registered_users集合は記録経路が限られ不完全なので、それだけだと実会員を弾く。
//  "member"     = 確実に会員（集合に居る or Supabase auth.usersに居る）
//  "not-member" = 確実に非会員（Supabase adminで確認でき、auth.usersに居ない）
//  "unknown"    = 確認手段が無い（集合に無い＋admin未設定）→ブロックせず招待を送り、承認時の本人ログインで担保する
export type MembershipStatus = "member" | "not-member" | "unknown";
export async function checkMembership(email: string | null | undefined): Promise<MembershipStatus> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return "not-member";
  // ① 記録済み集合（速い・居れば確実に会員）
  try {
    if ((await kv.sismember(REGISTERED_KEY, e)) === 1) return "member";
  } catch { /* noop */ }
  // ② Supabase admin（権威・service役鍵がVercelに有る時だけ）。auth.usersに居れば会員、居なければ非会員と断定。
  if (supabaseAdminConfigured()) {
    try {
      const users = await listAllAuthUsers();
      return users.some((u) => u.email === e) ? "member" : "not-member";
    } catch { /* フォールスルー */ }
  }
  // ③ 確認できない＝不明（ブロックしない）
  return "unknown";
}
