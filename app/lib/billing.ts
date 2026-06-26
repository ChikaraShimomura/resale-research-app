// 課金状態のKV層（サーバー専用）。Webhookが書き、getPlan が読む唯一の場所。
// メール(=Supabaseのemail・小文字)を主キーにする。Stripe顧客IDとの相互参照も持つ。
import { kv } from "@vercel/kv";
import type { PlanId } from "./plans";

// 有料プランごとの Stripe Price ID（Vercel env）。料金変更時はStripeで新Priceを作り env を差し替えるだけ。
// ⚠️ プロMAXを課金で出すには Vercel に STRIPE_PRICE_PROMAX を投入すること（未設定だと申込で 503）。
const PAID_KEYS = ["amateur", "veteran", "pro", "promax"] as const;
const PRICE_ENV: Record<(typeof PAID_KEYS)[number], string | undefined> = {
  amateur: process.env.STRIPE_PRICE_AMATEUR,
  veteran: process.env.STRIPE_PRICE_VETERAN,
  pro: process.env.STRIPE_PRICE_PRO,
  promax: process.env.STRIPE_PRICE_PROMAX,
};

// planId → Price ID（Checkout作成用）。未設定なら null。
export function priceIdFor(plan: PlanId): string | null {
  return (PAID_KEYS as readonly string[]).includes(plan) ? PRICE_ENV[plan as (typeof PAID_KEYS)[number]] || null : null;
}

// Price ID → planId（Webhookで購読の中身からプランを判定する用）。
export function planForPriceId(priceId: string | undefined | null): PlanId | null {
  if (!priceId) return null;
  for (const p of PAID_KEYS) {
    if (PRICE_ENV[p] && PRICE_ENV[p] === priceId) return p;
  }
  return null;
}

// 購読が「有効」とみなすStripeステータス（これ以外＝free降格）。
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface BillingState {
  planId: PlanId;            // amateur/veteran/pro（有効時）。失効時は free
  status: string;            // Stripeの subscription.status（active/trialing/canceled...）
  customerId?: string;       // Stripe Customer ID
  subscriptionId?: string;   // Stripe Subscription ID
  currentPeriodEnd?: number; // 期限(unix)。Customer Portalや表示に使える
  updatedAt: number;
}

const emailKey = (email: string) => `billing:email:${email.toLowerCase()}`;
const customerKey = (customerId: string) => `billing:customer:${customerId}`;

export async function getBillingState(email: string | null): Promise<BillingState | null> {
  if (!email) return null;
  try {
    return (await kv.get<BillingState>(emailKey(email))) ?? null;
  } catch {
    return null; // KV障害時はnull＝free扱い（フェイルクローズではなくフェイルオープン側）
  }
}

export async function setBillingState(email: string, state: BillingState): Promise<void> {
  // 単調性ガード: 既存より古い(updatedAt が小さい)イベントは破棄。
  // Webhookの順序逆転/再送で「解約→有効」のように新しい課金状態が古い値へ巻き戻るのを防ぐ。
  // 呼出側は state.updatedAt に Stripe イベントの created(発生時刻) を入れること（到着時刻ではなく）。
  try {
    const prev = await kv.get<BillingState>(emailKey(email));
    if (prev && typeof prev.updatedAt === "number" && state.updatedAt < prev.updatedAt) return;
  } catch { /* 取得失敗時はそのまま書く（可用性優先） */ }
  await kv.set(emailKey(email), state);
  if (state.customerId) await kv.set(customerKey(state.customerId), email.toLowerCase());
}

// Stripe顧客ID → メール（subscription.* イベントはメールを含まないため、checkout時に作った対応表で引く）。
export async function emailForCustomer(customerId: string): Promise<string | null> {
  try {
    return (await kv.get<string>(customerKey(customerId))) ?? null;
  } catch {
    return null;
  }
}

// 購読状態からプランを解決。有効でなければ free。
export function planFromBilling(state: BillingState | null): PlanId {
  if (!state) return "free";
  if (!ACTIVE_STATUSES.has(state.status)) return "free";
  return state.planId;
}

// メールから現在の購読プランを解決（getPlan の購読パート）。
export async function billingPlanFor(email: string | null): Promise<PlanId> {
  return planFromBilling(await getBillingState(email));
}
