// 画像一致レール(型番なしブランド品)の【AIプロキシ】。
// Pixel/Termux ワーカーには ANTHROPIC_API_KEY を置かない方針のため、AI判定(日本語→英語クエリ変換・2画像の同一判定)を
// このVercel側エンドポイント経由で実行する。ANTHROPIC_API_KEY は Vercel env にある＝Pixelに秘密を増やさずに済む。
// 認証: Pixel・Vercel が共通で持つ KV_REST_API_TOKEN の SHA-256 を x-ai-auth ヘッダで突合（生トークンはHTTPに乗せない）。
//        ＝新しい共有シークレットを作らずに、両者が既に持つ鍵から導出。middleware の同一オリジン検査からは除外(下記追加)。
// 実処理は app/lib/ebay/brandMatch.mjs をそのまま呼ぶ（Vercelでは process.env.ANTHROPIC_API_KEY があるので直接Anthropicを叩く）。
import crypto from "node:crypto";
import { jaToEnglishBrandQuery, imageSameProduct } from "../../../lib/ebay/brandMatch.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 画像一致は Haiku→Sonnet の2段(最大~15s)。既定10sだと稀に切れるため延長。

// KV_REST_API_TOKEN の SHA-256 を共有シークレットとして突合（生の値は送受信しない）。定数時間比較。
function authOk(req: Request): boolean {
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!tok) return false;
  const expect = crypto.createHash("sha256").update(tok).digest("hex");
  const got = req.headers.get("x-ai-auth") || "";
  if (got.length !== expect.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect)); } catch { return false; }
}

export async function POST(req: Request) {
  // ⏸ 2026-07-22 輸出ラボ畳み(ユーザー指示)：AIプロキシを閉鎖＝Anthropic支出の元栓。ワーカーが誤って再起動しても課金されない。
  //   再開は SERVICE_SHUTDOWN=0 か本ガード削除。
  if (process.env.SERVICE_SHUTDOWN !== "0") {
    return Response.json({ error: "shutdown", note: "輸出ラボ畳み中(2026-07-22)＝AIプロキシ停止" }, { status: 410 });
  }
  if (!authOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "ai-not-configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as {
    op?: string; brand?: string; name?: string; cat?: string;
    imageUrlA?: string; imageUrlB?: string; titleA?: string; titleB?: string;
  };
  const op = body?.op;
  try {
    if (op === "enquery") {
      const query = await jaToEnglishBrandQuery(body.brand, body.name, body.cat || "");
      return Response.json({ query: query ?? null });
    }
    if (op === "imgmatch") {
      const verdict = await imageSameProduct(body.imageUrlA, body.imageUrlB, { titleA: body.titleA || "", titleB: body.titleB || "" });
      return Response.json({ verdict });
    }
    return Response.json({ error: "bad op" }, { status: 400 });
  } catch {
    // 失敗は fail-safe（画像は unknown＝確定しない / 変換は null）。
    return Response.json(op === "imgmatch" ? { verdict: "unknown" } : { query: null });
  }
}
