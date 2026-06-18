// 行為者のプラン解決。サーバー専用。
// コンプ枠(COMP_EMAILS)＝マスター無料。それ以外は当面 free（Stripe購読連携は決済実装後）。
import { cookies } from "next/headers";
import { createSupabaseServerClient, isSupabaseConfigured } from "../supabase/server";
import { PlanId } from "../plans";

// あなた＋身内＝常にマスター無料。メールはソースに直書きせず Vercel 環境変数で持つ（公開リポジトリ対策）。
// 例: COMP_EMAILS="you@example.com,family@example.com"
const COMP_EMAILS = (process.env.COMP_EMAILS ?? "")
  .toLowerCase()
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 現在サインイン中ユーザーのメール（COMP判定用）。未サインイン/未設定なら null。
export async function getCurrentUserEmail(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const jar = await cookies();
  if (!jar.getAll().some((c) => c.name.startsWith("sb-"))) return null; // セッション無し＝即null(往復回避)
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data?.user?.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// コンプ枠(マスター無料)か。
export function isComp(email: string | null): boolean {
  return !!email && COMP_EMAILS.includes(email.toLowerCase());
}

// 行為者のプラン。今は「コンプ=master / それ以外=free」。決済実装後にここで Stripe 購読状態を読む。
export async function getPlan(): Promise<PlanId> {
  const email = await getCurrentUserEmail();
  if (isComp(email)) return "master";
  // TODO(決済): Stripe の購読状態を読んで beginner〜master / トライアル中 を返す。
  return "free";
}
