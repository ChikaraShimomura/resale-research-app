// Stripe カスタマーポータルのURLを返す（解約・支払い方法変更・領収書をユーザー自身が操作）。
// 前提: ログイン済み＋過去に購読して customerId が保存済み。無ければ案内のみ。
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { stripeConfigured, stripeRequest } from "../../../lib/stripe";
import { getBillingState } from "../../../lib/billing";

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

  const state = await getBillingState(email);
  if (!state?.customerId) {
    return Response.json({ ok: false, error: "ご契約中のサブスクが見つかりません。" }, { status: 404 });
  }

  try {
    const session = await stripeRequest("/billing_portal/sessions", {
      customer: state.customerId,
      return_url: `${originOf(req)}/settings`,
    });
    return Response.json({ ok: true, url: session.url });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "ポータルの起動に失敗しました。" }, { status: 502 });
  }
}
