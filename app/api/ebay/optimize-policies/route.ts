import { getActorId } from "../../../lib/auth/actor";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import { canAutoList } from "../../../lib/auth/plan";
import { optimizeFulfillmentPolicies } from "../../../lib/ebay/sellApi";
import { friendlyStepResults } from "../../../lib/ebay/errorMessages";

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

  // ★配送ポリシーの検査/修正も出品セットアップ＝有料プラン(ライト以上)限定。
  if (!(await canAutoList())) {
    return Response.json({ ok: false, needsPlan: true, error: "この操作にはeBay出品プラン（ライト以上）が必要です。" }, { status: 403 });
  }

  const result = await optimizeFulfillmentPolicies(token, MARKETPLACE);

  // 生eBayエラーの端的化・errorKind・errorDetail は setup-policies と共通処理に集約。
  const { steps: friendlySteps, errorKind, errorDetail } = friendlyStepResults(result.steps);

  return Response.json({
    ok: result.ok,
    steps: friendlySteps,
    fixedCount: result.fixedCount,
    codes: result.codes,
    errorKind,
    errorDetail,
  });
}
