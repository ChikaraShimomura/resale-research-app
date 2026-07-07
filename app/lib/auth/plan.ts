// 行為者のプラン解決。サーバー専用。
// 解決順: admin(ADMIN_EMAILS) → master(身内=COMP_EMAILS∪KV) → 購読(amateur/veteran/pro) → free。
// 決済(Stripe)が未設定/未購読なら自然に free に落ちる＝既存挙動は壊さない。
import { cookies } from "next/headers";
import { createSupabaseServerClient, isSupabaseConfigured } from "../supabase/server";
import { PlanId, PAYWALL_ENABLED, planCanAutoList, planCanDropship, planCanBuy } from "../plans";
import { isAdmin, isMaster } from "./admin";
import { billingPlanFor } from "../billing";

// 現在サインイン中ユーザーのメール（プラン判定用）。未サインイン/未設定なら null。
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

// 同時出品上限・満了(SOLD)の対象外（無制限）プランか。admin/master=あなた＋身内。
export function isUnlimited(plan: PlanId): boolean {
  return plan === "admin" || plan === "master";
}

// 行為者のプラン。admin/master を最優先で判定し、なければ Stripe 購読状態で解決。
export async function getPlan(): Promise<PlanId> {
  const email = await getCurrentUserEmail();
  if (!email) return "free";
  if (isAdmin(email)) return "admin";
  if (await isMaster(email)) return "master";
  return billingPlanFor(email); // amateur/veteran/pro（有効購読時）/ それ以外 free
}

// 利益商品カタログ（検索/結果/商品詳細/api products）を閲覧できる権限か。
// PAYWALL_ENABLED が立っている時だけ free（未購読）を弾く。OFFなら全員可＝決済未稼働で全ロックアウトを防ぐ安全装置。
// 有料(amateur/veteran/pro)・身内(master)・管理者(admin)のみ true。
export async function canViewCatalog(): Promise<boolean> {
  if (!PAYWALL_ENABLED) return true;
  return (await getPlan()) !== "free";
}

// eBay自動出品を使えるか＝有料プラン全て（ライト以上）＋身内/管理者。free(未購読)は不可。
// ※閲覧(canViewCatalog)と違いPAYWALL OFFでも有料判定する＝出品は購読者の機能。
export async function canAutoList(): Promise<boolean> {
  return planCanAutoList(await getPlan());
}

// 「在庫ありのまま登録＝無在庫転売」を許すか＝プロMAX限定（＋身内/管理者）。canAutoListより厳しい上位ゲート。
export async function canDropship(): Promise<boolean> {
  return planCanDropship(await getPlan());
}

// カタログの「仕入れた」等の操作を使えるか。★閲覧専用(viewer)だけ false＝カタログは全情報見れるが「仕入れた」は非表示。
// free/未購読は従来どおり true（PAYWALL OFF時やオンボーディングの挙動を壊さない）。
export async function canBuy(): Promise<boolean> {
  return planCanBuy(await getPlan());
}
