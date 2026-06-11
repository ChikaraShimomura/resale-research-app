import { cookies } from "next/headers";
import { deleteTokens } from "../../../lib/ebay/tokens";

// この端末（rr_did cookie）に紐づく eBay トークンを KV から削除して連携解除。
// 認証なし・端末単位モデルのため、共有端末で自分の連携を消せるようにする。
// middleware が /api への POST を同一オリジン必須にしているので CSRF 耐性あり。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const conn = (await cookies()).get("rr_did")?.value;
  if (conn) await deleteTokens(conn);
  return Response.json({ connected: false }, { headers: { "Cache-Control": "private, no-store" } });
}
