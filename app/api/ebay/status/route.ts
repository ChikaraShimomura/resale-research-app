import { cookies } from "next/headers";
import { ebayConfigured } from "../../../lib/ebay/oauth";
import { loadTokens, tokenEncryptionReady } from "../../../lib/ebay/tokens";

// このデバイスが eBay 連携済みか返す（UI の「連携する/連携済み」表示用）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = ebayConfigured() && tokenEncryptionReady();
  const conn = (await cookies()).get("rr_did")?.value;
  if (!conn) {
    return Response.json({ connected: false, configured }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const t = await loadTokens(conn);
  return Response.json(
    { connected: Boolean(t), configured },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
