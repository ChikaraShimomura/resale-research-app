import { getActorId } from "../../../lib/auth/actor";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import {
  optInSellingPolicyManagement,
  createPaymentPolicy,
  createReturnPolicy,
  createShippingPolicy,
} from "../../../lib/ebay/sellApi";
import { friendlyStepResults } from "../../../lib/ebay/errorMessages";

// ビジネスポリシー一括作成/更新（オプトイン + 支払い + 返品 + サイズ別配送）。
// 各ステップの成否を返すので、失敗箇所と eBay のエラー文がそのまま分かる。
// 発送先は sellApi 側で Worldwide（全世界）固定（理由は sellApi.ts の intlShippingOption コメント参照）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACE = "EBAY_US";

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
    returnsAccepted?: boolean;
    returnDays?: number;
    freeShipping?: boolean; // 送料無料(送料込み)ポリシーも作るか。未指定=作る（送料込みトグルの相手になる）。
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
    const f = await createShippingPolicy(token, MARKETPLACE, `Shipping ${s.key}`, handlingDays, String(s.value).trim());
    steps.push({ step: `配送ポリシー(${s.key})`, ok: f.ok, error: f.error });
  }

  // 送料無料(送料込み)ポリシー。未指定=作る。これがあると出品/編集の「送料込み」トグルが使えるようになる
  //（買い手の送料は$0・送料は商品価格に内包する運用）。costUsd省略=無料。発送日数・発送先はサイズ別と同じ。
  if (body.freeShipping !== false) {
    const free = await createShippingPolicy(token, MARKETPLACE, "Shipping Free", handlingDays);
    steps.push({ step: "配送ポリシー(送料無料・送料込み)", ok: free.ok, error: free.error });
  }

  const ok = steps.every((s) => s.ok);
  // 各ステップの生eBayエラーを端的な要因に変換し、errorKind/errorDetail をまとめる（最適化APIと共通処理）。
  const { steps: friendlySteps, errorKind, errorDetail } = friendlyStepResults(steps);
  return Response.json({ ok, steps: friendlySteps, errorKind, errorDetail });
}
