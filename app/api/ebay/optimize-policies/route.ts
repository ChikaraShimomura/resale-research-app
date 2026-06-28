import { kv } from "@vercel/kv";
import { getActorId } from "../../../lib/auth/actor";
import { getValidAccessToken } from "../../../lib/ebay/tokens";
import { optimizeFulfillmentPolicies, getPolicyCodesSummary, type PolicyOptimizeStep } from "../../../lib/ebay/sellApi";
import { friendlyEbayError } from "../../../lib/ebay/errorMessages";

// 既存の配送ポリシーを検査し、米国キャリア(USPS等)/国際発送欠落を「正しい設定」へ直してeBayへ同期する。
// 正しいサービスコードは既存の正しいポリシー(手動修正済み等)から読み戻す＝推測しない。基準が無ければ既定。
// 生eBayエラーは端的な要因へ変換し、未知が混じれば errorKind=unexpected で報告導線を出せるようにする（setup-policies と同作法）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETPLACE = "EBAY_US";
// 発送先（アメリカは常に DOMESTIC で対象）。setup-policies / EbayPolicySetup の推奨と一致させる。
const DEFAULT_REGIONS = ["AU", "GB", "CA", "DE", "FR", "JP", "HK", "SG", "TW", "KR"];

export async function POST() {
  const conn = await getActorId();
  if (!conn) return Response.json({ ok: false, error: "device not identified" }, { status: 401 });

  const token = await getValidAccessToken(conn);
  if (!token) return Response.json({ ok: false, error: "eBay未連携です。先に連携してください。" }, { status: 401 });

  const result = await optimizeFulfillmentPolicies(token, MARKETPLACE, DEFAULT_REGIONS);

  // 診断(一時): 検出した生サービスコードをKVに残す。復号鍵なしでローカルから原因を確認するため。
  try {
    await kv.lpush(
      "ebay:optimize_diag",
      JSON.stringify({ conn, ok: result.ok, codes: result.codes, seen: result.seen, ts: new Date().toISOString() })
    );
    await kv.ltrim("ebay:optimize_diag", 0, 19);
    await kv.expire("ebay:optimize_diag", 7 * 24 * 60 * 60);
  } catch {
    /* 診断失敗は無視 */
  }

  // 一時診断: 全連携アカウントの国内/国際コードをまとめてKVに記録（復号鍵はサーバーにあるので全垢読める）。
  // 「Economy International Shipping」の正規コードを持つ垢を特定し、既定にハードコードするため。原因特定後に撤去。
  try {
    const keys = (await kv.keys("ebay_token:*")) ?? [];
    const accounts: { conn: string; policies: { name: string; dom: string | null; intl: string | null }[] | null }[] = [];
    for (const k of keys) {
      const c = k.replace(/^ebay_token:/, "");
      const tk = await getValidAccessToken(c);
      accounts.push({ conn: c, policies: tk ? await getPolicyCodesSummary(tk, MARKETPLACE) : null });
    }
    await kv.set("ebay:all_accounts_diag", { ts: new Date().toISOString(), accounts });
  } catch {
    /* 診断失敗は無視 */
  }

  const friendlySteps = result.steps.map((s) => {
    // こちらが意図して出す案内(known)はそのまま見せる（生eBayエラー変換も「報告」導線も出さない）。
    if (s.ok || !s.error || s.known) return s;
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
