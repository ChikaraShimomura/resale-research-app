// アプリ内の「行為者ID」。サインイン済みなら永続アカウントID(acct:<uuid>)を、未サインイン(ゲスト)なら
// 端末Cookie rr_did を返す。eBayトークン/利益台帳(ebay_deals)/SKU対応表/売却キャッシュ など
// アクター単位の全データはこの戻り値をキーに引く。
// Supabase未設定 or セッション無しのときは従来どおり rr_did を返す＝挙動完全不変（認証は任意・非破壊）。
import { cookies } from "next/headers";
import { createSupabaseServerClient, isSupabaseConfigured } from "../supabase/server";

const DEVICE_COOKIE = "rr_did";

export async function getActorId(): Promise<string | undefined> {
  const jar = await cookies();
  const did = jar.get(DEVICE_COOKIE)?.value;
  if (!isSupabaseConfigured()) return did; // 認証未設定＝従来挙動

  // Supabaseのセッションcookie(sb-*)が無ければ即ゲスト（不要なネットワーク往復を避ける）
  const hasSession = jar.getAll().some((c) => c.name.startsWith("sb-"));
  if (!hasSession) return did;

  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) return `acct:${data.user.id}`;
  } catch {
    /* セッション取得失敗時はゲストにフォールバック */
  }
  return did;
}

// acct:<uuid> 形式（サインイン済みアカウント）か。サインイン時のデータ移行などで使う。
export function isAccountId(id?: string | null): boolean {
  return !!id && id.startsWith("acct:");
}
