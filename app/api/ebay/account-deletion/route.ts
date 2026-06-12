import crypto from "node:crypto";

// eBay Marketplace Account Deletion/Closure 通知エンドポイント。
// GET: eBayの検証チャレンジに応答（SHA-256(challengeCode + verificationToken + endpointURL) を返す）。
// POST: ユーザー削除通知を受信して 200 を返す。
// 検証トークンは既定値を持たせ、Vercel env なしでも動作する（eBayの削除通知の検証トークンは
// 機微度が低く、漏れても悪用余地がないため埋め込み可）。env で上書きも可。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERIFICATION_TOKEN =
  process.env.EBAY_VERIFICATION_TOKEN ?? "omeJkFS4ud1Ma-H_AYKp7kpo1k_R_7YEMOFfbgriCJo";

// ハッシュに使う endpoint 文字列は「eBayが実際に呼んだURL（クエリ除く）」を採用する。
// こうするとポータルに登録したURLと必ず一致し、URL表記揺れによる検証失敗を防げる。
function resolveEndpoint(req: Request): string {
  if (process.env.EBAY_DELETION_ENDPOINT) return process.env.EBAY_DELETION_ENDPOINT;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}${url.pathname}`;
}

export async function GET(req: Request) {
  const challengeCode = new URL(req.url).searchParams.get("challenge_code");
  if (!challengeCode) {
    return new Response("missing challenge_code", { status: 400 });
  }
  // SHA-256( challengeCode + verificationToken + endpoint ) の16進ダイジェスト
  const hash = crypto.createHash("sha256");
  hash.update(challengeCode);
  hash.update(VERIFICATION_TOKEN);
  hash.update(resolveEndpoint(req));
  const challengeResponse = hash.digest("hex");

  return Response.json({ challengeResponse }, { status: 200 });
}

export async function POST(req: Request) {
  // 実際のアカウント削除/閉鎖通知。受信を確認したら速やかに 200 を返す（eBay要件）。
  // 本アプリはeBayユーザーID単位の個人データを保持しておらず、eBay連携トークンは
  // 端末(rr_did)単位の暗号化保管・ユーザー解除可。該当する保持データは無いため確認応答のみ。
  try {
    await req.json().catch(() => null);
  } catch {
    /* noop */
  }
  return new Response(null, { status: 200 });
}
