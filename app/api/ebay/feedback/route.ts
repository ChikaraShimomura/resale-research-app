import { getActorId } from "../../../lib/auth/actor";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import { getFeedbackScore } from "../../../lib/ebay/feedback";

// 本人のeBayフィードバック評価数（育成ページの「現在地」を実数字で出すため）。承認・再連携は不要
// （Trading API GetUser を既存OAuthトークンで叩く）。取得失敗/未連携は score:null＝呼び出し側が販売記録に自動フォールバック。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const actor = await getActorId();
  if (!actor) return Response.json({ ok: false, score: null, positivePct: null }, { headers });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, score: null, positivePct: null }, { headers });
  const fb = await getFeedbackScore(token);
  return Response.json({ ok: true, ...fb }, { headers });
}
