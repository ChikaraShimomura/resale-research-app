// Supabase 管理者クライアント（service_role）。サーバー専用・管理画面のユーザー一覧用。
// service_role はフルアクセス鍵なので絶対にクライアントへ出さない。env 未設定なら無効（KVフォールバックに切替）。
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY; // Vercel/envに入れる（Project Settings→API→service_role）

export function supabaseAdminConfigured(): boolean {
  return !!URL && !!SERVICE;
}

export interface AuthUser {
  email: string;
  createdAt?: string;
  lastSignInAt?: string;
}

// 全認証ユーザーをページングで取得（最大1000件で打ち切り）。メールが無いユーザーは除外。
export async function listAllAuthUsers(): Promise<AuthUser[]> {
  if (!URL || !SERVICE) return [];
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    const users = data?.users ?? [];
    if (error || users.length === 0) break;
    for (const u of users) {
      if (u.email) out.push({ email: u.email.toLowerCase(), createdAt: u.created_at, lastSignInAt: u.last_sign_in_at ?? undefined });
    }
    if (users.length < 50) break;
  }
  return out;
}
