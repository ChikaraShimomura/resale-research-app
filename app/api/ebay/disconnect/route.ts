import { cookies } from "next/headers";
import { kv } from "@vercel/kv";
import { deleteTokens } from "../../../lib/ebay/tokens";
import { SKU_MAP_KEY } from "../../../lib/ebay/listing";

// この端末（rr_did cookie）に紐づく eBay トークンを KV から削除して連携解除。
// 認証なし・端末単位モデルのため、共有端末で自分の連携を消せるようにする。
// middleware が /api への POST を同一オリジン必須にしているので CSRF 耐性あり。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const conn = (await cookies()).get("rr_did")?.value;
  if (conn) {
    await deleteTokens(conn);
    // 売却検知の派生キーも削除（rr_did は端末固定なので、残すと同一端末で別アカ再連携時に
    // 前アカの売却済み商品が漏れて誤フィルタされる）。フェイルオープン。
    try {
      await kv.del(`ebay_sold:${conn}`);
    } catch {
      /* noop */
    }
    try {
      await kv.del(SKU_MAP_KEY(conn));
    } catch {
      /* noop */
    }
  }
  return Response.json({ connected: false }, { headers: { "Cache-Control": "private, no-store" } });
}
