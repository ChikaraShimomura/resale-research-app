import { getActorId } from "../../../lib/auth/actor";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import {
  optInSellingPolicyManagement,
  createPaymentPolicy,
  createReturnPolicy,
  createFlatIntlFulfillmentPolicy,
} from "../../../lib/ebay/sellApi";
import { friendlyEbayError } from "../../../lib/ebay/errorMessages";

// ビジネスポリシー一括作成/更新（オプトイン + 支払い + 返品 + サイズ別配送）。
// 各ステップの成否を返すので、失敗箇所と eBay のエラー文がそのまま分かる。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACE = "EBAY_US";
// 国際発送を許可できる国コード（ホワイトリスト）。送料計算は米国基準なので主要英語/EU圏に絞る。
// ⚠️ IT(イタリア)/ES(スペイン)は不可：EBAY_US の配送ポリシーでは発送先に登録できず、
//    createFulfillmentPolicy が errorId=216347「unsupported destinations for this marketplace」で落ちる
//    （EUのVAT/輸入規制絡み）。UI(EbayPolicySetup の COUNTRIES)と必ず一致させること。
const ALLOWED_REGIONS = ["AU", "GB", "CA", "DE", "FR"];
const DEFAULT_REGIONS = ["AU", "GB"];

export async function POST(req: Request) {
  const conn = await getActorId();
  if (!conn) return Response.json({ ok: false, error: "device not identified" }, { status: 401 });

  const token = await getValidAccessToken(conn);
  if (!token) return Response.json({ ok: false, error: "eBay未連携です。先に連携してください。" }, { status: 401 });

  let body: {
    handlingDays?: number;
    small?: string;
    medium?: string;
    large?: string;
    regions?: string[];
    returnsAccepted?: boolean;
    returnDays?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const handlingDays = Number(body.handlingDays) > 0 ? Math.floor(Number(body.handlingDays)) : 7;
  // 発送先の国：ホワイトリストで濾過し重複除去。未指定/不正は規定(AU/GB)。空配列なら米国のみ(国際発送なし)。
  const regions = Array.isArray(body.regions)
    ? [...new Set(body.regions.filter((r) => ALLOWED_REGIONS.includes(r)))]
    : DEFAULT_REGIONS;
  // 返品：既定は返品不可。返品可なら期間(日)は1〜90にクランプ(既定30)。
  const returnsAccepted = body.returnsAccepted === true;
  const returnDays = returnsAccepted ? Math.min(90, Math.max(1, Math.floor(Number(body.returnDays) || 30))) : 30;
  // 送料は数値(>0)のみ受理し、eBay受理形(小数2桁)へ正規化。非数値/全角/空はここで除外。
  const sizes = [
    { key: "Small", value: body.small },
    { key: "Medium", value: body.medium },
    { key: "Large", value: body.large },
  ]
    .map((s) => ({ key: s.key, n: Number(String(s.value ?? "").trim()) }))
    .filter((s) => Number.isFinite(s.n) && s.n > 0)
    .map((s) => ({ key: s.key, value: s.n.toFixed(2) }));

  if (sizes.length === 0) {
    return Response.json({ ok: false, error: "サイズ別の送料を半角数字で1つ以上入力してください。" }, { status: 400 });
  }

  const steps: { step: string; ok: boolean; error?: string }[] = [];

  const optIn = await optInSellingPolicyManagement(token);
  steps.push({ step: "ビジネスポリシー有効化", ok: optIn.ok, error: optIn.error });

  const pay = await createPaymentPolicy(token, MARKETPLACE);
  steps.push({ step: "支払いポリシー", ok: pay.ok, error: pay.error });

  const ret = await createReturnPolicy(token, MARKETPLACE, returnsAccepted, returnDays);
  steps.push({
    step: returnsAccepted ? `返品ポリシー（${returnDays}日返品可・返送料は買い手）` : "返品ポリシー（返品不可）",
    ok: ret.ok,
    error: ret.error,
  });

  for (const s of sizes) {
    const f = await createFlatIntlFulfillmentPolicy(
      token,
      MARKETPLACE,
      `Shipping ${s.key}`,
      String(s.value).trim(),
      handlingDays,
      regions
    );
    steps.push({ step: `配送ポリシー(${s.key})`, ok: f.ok, error: f.error });
  }

  const ok = steps.every((s) => s.ok);
  // 各ステップの生eBayエラーを端的な要因に変換（生は errorDetail に温存・UIには出さない）。
  // 未知のステップが1つでもあれば errorKind=unexpected ＝UIで報告導線を出せる。
  const friendlySteps = steps.map((s) => {
    if (s.ok || !s.error) return s;
    const f = friendlyEbayError(s.error);
    return { ...s, error: f.message, known: f.known, errorDetail: s.error };
  });
  const errorKind = friendlySteps.some((s) => !s.ok && (s as { known?: boolean }).known === false) ? "unexpected" : "known";
  return Response.json({ ok, steps: friendlySteps, errorKind });
}
