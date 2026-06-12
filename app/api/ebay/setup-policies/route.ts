import { cookies } from "next/headers";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import {
  optInSellingPolicyManagement,
  createPaymentPolicy,
  createNoReturnPolicy,
  createFlatIntlFulfillmentPolicy,
} from "../../../lib/ebay/sellApi";

// ビジネスポリシー一括作成（オプトイン + 支払い + 返品不可 + サイズ別配送）。
// 各ステップの成否を返すので、失敗箇所と eBay のエラー文がそのまま分かる。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACE = "EBAY_US";

export async function POST(req: Request) {
  const jar = await cookies();
  const conn = jar.get("rr_did")?.value;
  if (!conn) return Response.json({ ok: false, error: "device not identified" }, { status: 401 });

  const token = await getValidAccessToken(conn);
  if (!token) return Response.json({ ok: false, error: "eBay未連携です。先に連携してください。" }, { status: 401 });

  let body: { handlingDays?: number; small?: string; medium?: string; large?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const handlingDays = Number(body.handlingDays) > 0 ? Math.floor(Number(body.handlingDays)) : 3;
  const sizes = [
    { key: "Small", value: body.small },
    { key: "Medium", value: body.medium },
    { key: "Large", value: body.large },
  ].filter((s) => s.value != null && String(s.value).trim() !== "");

  if (sizes.length === 0) {
    return Response.json({ ok: false, error: "サイズ別の送料を少なくとも1つ入力してください。" }, { status: 400 });
  }

  const steps: { step: string; ok: boolean; error?: string }[] = [];

  const optIn = await optInSellingPolicyManagement(token);
  steps.push({ step: "ビジネスポリシー有効化", ok: optIn.ok, error: optIn.error });

  const pay = await createPaymentPolicy(token, MARKETPLACE);
  steps.push({ step: "支払いポリシー", ok: pay.ok, error: pay.error });

  const ret = await createNoReturnPolicy(token, MARKETPLACE);
  steps.push({ step: "返品ポリシー（返品不可）", ok: ret.ok, error: ret.error });

  for (const s of sizes) {
    const f = await createFlatIntlFulfillmentPolicy(
      token,
      MARKETPLACE,
      `Shipping ${s.key}`,
      String(s.value).trim(),
      handlingDays
    );
    steps.push({ step: `配送ポリシー(${s.key})`, ok: f.ok, error: f.error });
  }

  const ok = steps.every((s) => s.ok);
  return Response.json({ ok, steps });
}
