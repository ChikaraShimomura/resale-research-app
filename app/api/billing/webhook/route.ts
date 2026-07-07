// Stripe Webhook 受け口。購読の作成/更新/解約を受けて KV の課金状態を更新する。
// 署名(STRIPE_WEBHOOK_SECRET)で正当性を検証＝外部POSTだが各自トークンで確認するため middleware の同一オリジン検査からは除外する。
import { verifyStripeEvent } from "../../../lib/stripe";
import { setBillingState, getBillingState, emailForCustomer, planForPriceId, type BillingState } from "../../../lib/billing";
import { recordFunnelEvent } from "../../../lib/funnelServer";
import { planRank, type PlanId } from "../../../lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Obj = Record<string, unknown>;

// 有効とみなすStripeステータス（billing.ts の ACTIVE_STATUSES と同義・アップグレード判定に使う）。
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function POST(req: Request) {
  const raw = await req.text(); // 署名検証のため生ボディが必要（JSONにする前に取る）
  const sig = req.headers.get("stripe-signature");
  const event = verifyStripeEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return new Response("invalid signature", { status: 400 });

  const type = String(event.type ?? "");
  const obj = ((event.data as Obj | undefined)?.object as Obj | undefined) ?? {};
  // 単調性ガード用: Stripeイベントの発生時刻(created)。到着時刻でなくこれで新旧比較（setBillingStateが古いものを破棄）。
  const eventTs = Number((event as { created?: number }).created) || Math.floor(Date.now() / 1000);

  try {
    if (type === "checkout.session.completed") {
      // 顧客IDとメールの対応表を確実に作る（以降の subscription.* でメールを引けるように）。
      const meta = (obj.metadata as Obj | undefined) ?? {};
      const email = String(meta.email ?? obj.client_reference_id ?? obj.customer_email ?? "").toLowerCase();
      const customerId = obj.customer ? String(obj.customer) : undefined;
      const planId = (meta.planId as PlanId | undefined) ?? "free";
      if (email) {
        // 後続の subscription.* が正確な状態で上書きするが、順序逆転/同時刻でトライアルを潰さないよう前状態を尊重する。
        //（trialing を active に上書き＋currentPeriodEnd 消去で TrialBanner が消える不具合の防止）。
        const prev = await getBillingState(email);
        const state: BillingState = {
          planId,
          status: prev && prev.status === "trialing" ? "trialing" : "active",
          customerId,
          subscriptionId: obj.subscription ? String(obj.subscription) : undefined,
          currentPeriodEnd: prev?.currentPeriodEnd,
          updatedAt: eventTs,
        };
        await setBillingState(email, state);
      }
      await recordFunnelEvent("subscribed"); // 収益ファネル：課金成立を計上（チェックアウト完了＝新規購読）
    } else if (type === "customer.subscription.created") {
      await applySubscription(obj, eventTs, true);
    } else if (type === "customer.subscription.updated") {
      await applySubscription(obj, eventTs, false);
    } else if (type === "customer.subscription.deleted") {
      const email = await resolveEmail(obj);
      if (email) {
        await setBillingState(email, {
          planId: "free",
          status: "canceled",
          customerId: obj.customer ? String(obj.customer) : undefined,
          subscriptionId: obj.id ? String(obj.id) : undefined,
          updatedAt: eventTs,
        });
        await recordFunnelEvent("churned"); // 継続計測：解約を計上
      }
    }
  } catch {
    // 処理失敗でも 200 を返すと Stripe は再送しない。500 を返して再送に任せる。
    return new Response("handler error", { status: 500 });
  }

  return Response.json({ received: true });
}

// subscription オブジェクトから課金状態を組み立てて保存し、前状態との差分で遷移を計測する。
// isCreated=true（subscription.created）: トライアル開始を計上。false（updated）: トライアル→有料/アップグレードを計上。
async function applySubscription(sub: Obj, eventTs: number, isCreated: boolean): Promise<void> {
  const email = await resolveEmail(sub);
  if (!email) return;
  const priceId = priceIdOf(sub);
  const meta = (sub.metadata as Obj | undefined) ?? {};
  const planId = planForPriceId(priceId) ?? (meta.planId as PlanId | undefined) ?? "free";
  const status = String(sub.status ?? "active");

  // 遷移計測は前状態と比較。setBillingState の単調性ガードと整合させ、古い(再送/順序逆転)イベントでは計上しない。
  const prev = await getBillingState(email);
  const stale = !!prev && typeof prev.updatedAt === "number" && eventTs < prev.updatedAt;
  if (!stale) {
    if (isCreated) {
      if (status === "trialing") await recordFunnelEvent("trial_started"); // 無料トライアルで開始
    } else if (prev) {
      if (prev.status === "trialing" && status === "active") {
        await recordFunnelEvent("trial_converted"); // トライアル→有料に転換（最重要指標）
      } else if (ACTIVE_STATUSES.has(status) && planRank(planId) > planRank(prev.planId)) {
        await recordFunnelEvent("upgraded"); // 上位プランへアップグレード
      }
    }
  }

  await setBillingState(email, {
    planId,
    status,
    customerId: sub.customer ? String(sub.customer) : undefined,
    subscriptionId: sub.id ? String(sub.id) : undefined,
    currentPeriodEnd: currentPeriodEndOf(sub),
    updatedAt: eventTs,
  });
}

// subscription.metadata.email → なければ customerId からの対応表で引く。
async function resolveEmail(sub: Obj): Promise<string | null> {
  const meta = (sub.metadata as Obj | undefined) ?? {};
  const fromMeta = meta.email ? String(meta.email).toLowerCase() : "";
  if (fromMeta) return fromMeta;
  if (sub.customer) return emailForCustomer(String(sub.customer));
  return null;
}

function priceIdOf(sub: Obj): string | null {
  const items = (sub.items as Obj | undefined)?.data as Obj[] | undefined;
  const price = items?.[0]?.price as Obj | undefined;
  return price?.id ? String(price.id) : null;
}

// 期限(unix)。旧APIは subscription.current_period_end、新API(2025-03.basil〜)は
// subscription.items.data[].current_period_end に移動したため両対応。表示用なので無ければ undefined。
function currentPeriodEndOf(sub: Obj): number | undefined {
  if (typeof sub.current_period_end === "number") return sub.current_period_end;
  const items = (sub.items as Obj | undefined)?.data as Obj[] | undefined;
  const cpe = items?.[0]?.current_period_end;
  return typeof cpe === "number" ? cpe : undefined;
}
