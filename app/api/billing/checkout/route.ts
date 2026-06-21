// Stripe Checkout セッションを作って決済ページのURLを返す。
// 前提: ログイン済み（email がある）＋ STRIPE_SECRET_KEY と該当プランの Price ID が設定済み。
// 未設定なら 503「準備中」＝既存挙動を壊さない（料金ページ側もPAYWALL_ENABLEDが立つまで申込ボタンを出さない）。
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { stripeConfigured, stripeRequest } from "../../../lib/stripe";
import { priceIdFor, getBillingState } from "../../../lib/billing";
import { trialDaysFor, PAID_PLAN_IDS, type PlanId } from "../../../lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originOf(req: Request): string {
  const o = req.headers.get("origin");
  if (o) return o;
  const host = req.headers.get("host");
  return host ? `https://${host}` : "";
}

export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return Response.json({ ok: false, error: "決済は現在準備中です。" }, { status: 503 });
  }

  const email = await getCurrentUserEmail();
  if (!email) return Response.json({ ok: false, error: "ログインが必要です。" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { planId?: string };
  const planId = body.planId as PlanId | undefined;
  if (!planId || !PAID_PLAN_IDS.includes(planId)) {
    return Response.json({ ok: false, error: "プランが正しくありません。" }, { status: 400 });
  }

  const priceId = priceIdFor(planId);
  if (!priceId) return Response.json({ ok: false, error: "このプランは現在準備中です。" }, { status: 503 });

  const origin = originOf(req);
  const existing = await getBillingState(email);

  // env に Price ID(price_…) ではなく Product ID(prod_…) が設定されていても動くよう、その場合は商品の既定価格に解決する。
  let lineItemPrice = priceId;
  if (priceId.startsWith("prod_")) {
    try {
      const prod = await stripeRequest(`/products/${priceId}`, {}, "GET");
      if (prod.default_price) lineItemPrice = String(prod.default_price);
    } catch {
      /* 解決できなければそのまま（Stripe側のエラーで気づける） */
    }
  }

  const params: Record<string, unknown> = {
    mode: "subscription",
    "line_items[0][price]": lineItemPrice,
    "line_items[0][quantity]": 1,
    client_reference_id: email,
    success_url: `${origin}/settings?billing=success`,
    cancel_url: `${origin}/pricing?billing=cancel`,
    allow_promotion_codes: true,
    "metadata[planId]": planId,
    "metadata[email]": email,
    "subscription_data[metadata][planId]": planId,
    "subscription_data[metadata][email]": email,
  };
  // 既存顧客は再利用（重複Customerを作らない）。無ければメールで新規作成。
  if (existing?.customerId) params.customer = existing.customerId;
  else params.customer_email = email;

  const trial = trialDaysFor(planId);
  if (trial > 0) params["subscription_data[trial_period_days]"] = trial;

  try {
    const session = await stripeRequest("/checkout/sessions", params);
    return Response.json({ ok: true, url: session.url });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "決済の開始に失敗しました。" }, { status: 502 });
  }
}
