// 身内(master)の指定API。管理者(admin)のみ。
// GET   : 身内一覧（env初期分=消せない / KV管理分=消せる）
// POST   {email}: 身内に追加
// DELETE {email}: 身内から削除（KV管理分のみ）
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { isAdmin, listMasters, addMaster, removeMaster, listRegisteredUsers } from "../../../lib/auth/admin";
import { supabaseAdminConfigured, listAllAuthUsers } from "../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureAdmin(): Promise<boolean> {
  return isAdmin(await getCurrentUserEmail());
}

// 身内一覧（env固定/KV管理）＋ 登録ユーザー一覧（Supabase優先・無ければKV記録でフォールバック）をまとめて返す。
// users には isAdmin/isMaster/removable のフラグを付け、検索つきUIでそのまま身内指定/解除できるようにする。
async function fullState() {
  const { env, managed } = await listMasters();
  const masterSet = new Set([...env, ...managed]);
  const managedSet = new Set(managed);

  let base: { email: string; createdAt?: string; lastSignInAt?: string }[];
  let source: "supabase" | "kv";
  if (supabaseAdminConfigured()) {
    base = await listAllAuthUsers();
    source = "supabase";
  } else {
    base = (await listRegisteredUsers()).map((email) => ({ email }));
    source = "kv";
  }

  const users = base
    .map((u) => ({
      ...u,
      isAdmin: isAdmin(u.email),
      isMaster: masterSet.has(u.email),
      removable: managedSet.has(u.email), // env固定/管理者は解除不可、KV管理分のみ解除可
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return { env, managed, source, users };
}

export async function GET() {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  return Response.json({ ok: true, ...(await fullState()) });
}

export async function POST(req: Request) {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  try {
    await addMaster(String(email ?? ""));
  } catch {
    return Response.json({ ok: false, error: "メールアドレスが正しくありません。" }, { status: 400 });
  }
  return Response.json({ ok: true, ...(await fullState()) });
}

export async function DELETE(req: Request) {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  await removeMaster(String(email ?? ""));
  return Response.json({ ok: true, ...(await fullState()) });
}
