import { getActorId } from "../../../lib/auth/actor";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import { optimizeFulfillmentPolicies, type PolicyOptimizeStep } from "../../../lib/ebay/sellApi";
import { friendlyEbayError } from "../../../lib/ebay/errorMessages";

// 既存の配送ポリシーを検査し、米国キャリア(USPS等)/国際発送欠落を「正しい設定」へ直してeBayへ同期する。
// 正しい設定＝国内 EconomyShippingFromOutsideUS / 国際 OtherInternational(表示「Economy International Shipping」)。
// 生eBayエラーは端的な要因へ変換し、未知が混じれば errorKind=unexpected で報告導線を出す（setup-policies と同作法）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACE = "EBAY_US";

export async function POST() {
  const conn = await getActorId();
  if (!conn) return Response.json({ ok: false, error: "device not identified" }, { status: 401 });

  const token = await getValidAccessToken(conn);
  if (!token) return Response.json({ ok: false, error: "eBay未連携です。先に連携してください。" }, { status: 401 });

  const result = await optimizeFulfillmentPolicies(token, MARKETPLACE);

  const friendlySteps = result.steps.map((s) => {
    if (s.ok || !s.error) return s;
    const f = friendlyEbayError(s.error);
    return { ...s, error: f.message, known: f.known, errorDetail: s.error };
  });
  const errorKind = friendlySteps.some((s) => !s.ok && (s as { known?: boolean }).known === false)
    ? "unexpected"
    : "known";

  const errorDetail = friendlySteps
    .filter((s: PolicyOptimizeStep) => !s.ok)
    .map((s) => `${s.step}: ${(s as { errorDetail?: string }).errorDetail || s.error || ""}`)
    .join(" | ");

  return Response.json({
    ok: result.ok,
    steps: friendlySteps,
    fixedCount: result.fixedCount,
    codes: result.codes,
    errorKind,
    errorDetail: errorDetail || undefined,
  });
}
