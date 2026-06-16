// Supabase サーバークライアント（Route Handler / Server Action / Server Component 用）。
// @supabase/ssr のクッキー方式。env未設定なら isSupabaseConfigured() が false を返し、
// 呼び出し側は従来の rr_did ゲスト挙動にフォールバックする（認証は完全に任意・非破壊）。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

// サーバー側 Supabase クライアント。Server Component から呼ばれた場合は cookie 書き込み不可なので
// setAll は握りつぶす（セッション更新は Route Handler / Server Action 側で行う）。
export async function createSupabaseServerClient() {
  const jar = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* Server Component からは書けない。Route Handler/Server Action 側で更新される */
        }
      },
    },
  });
}
