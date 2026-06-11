import { cookies } from "next/headers";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import {
  countFulfillmentPolicies,
  countPaymentPolicies,
  countReturnPolicies,
  countInventoryLocations,
} from "../../../lib/ebay/sellApi";

// 「写真だけ出品」の準備状況チェック（読み取り専用）。
// 接続状況 + ビジネスポリシー(支払い/返品/配送) + 在庫ロケーションの有無を返す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const marketplace = new URL(req.url).searchParams.get("marketplace") || "EBAY_US";

  const jar = await cookies();
  const conn = jar.get("rr_did")?.value;
  if (!conn) return Response.json({ connected: false });

  const token = await getValidAccessToken(conn);
  if (!token) return Response.json({ connected: false });

  const [fulfillment, payment, ret, locations] = await Promise.all([
    countFulfillmentPolicies(token, marketplace),
    countPaymentPolicies(token, marketplace),
    countReturnPolicies(token, marketplace),
    countInventoryLocations(token),
  ]);

  const ready = fulfillment > 0 && payment > 0 && ret > 0 && locations > 0;

  return Response.json(
    {
      connected: true,
      marketplace,
      fulfillmentPolicies: fulfillment,
      paymentPolicies: payment,
      returnPolicies: ret,
      locations,
      ready,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
