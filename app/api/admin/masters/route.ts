// 身内(master)の指定API。管理者(admin)のみ。
// GET   : 身内一覧（env初期分=消せない / KV管理分=消せる）
// POST   {email}: 身内に追加
// DELETE {email}: 身内から削除（KV管理分のみ）
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { isAdmin, listMasters, addMaster, removeMaster } from "../../../lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureAdmin(): Promise<boolean> {
  return isAdmin(await getCurrentUserEmail());
}

export async function GET() {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  return Response.json({ ok: true, ...(await listMasters()) });
}

export async function POST(req: Request) {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  try {
    await addMaster(String(email ?? ""));
  } catch {
    return Response.json({ ok: false, error: "メールアドレスが正しくありません。" }, { status: 400 });
  }
  return Response.json({ ok: true, ...(await listMasters()) });
}

export async function DELETE(req: Request) {
  if (!(await ensureAdmin())) return Response.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  await removeMaster(String(email ?? ""));
  return Response.json({ ok: true, ...(await listMasters()) });
}
