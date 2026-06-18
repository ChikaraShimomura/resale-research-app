import sharp from "sharp";
import { cleanupBakedText } from "../../lib/ebay/imageCleanup";

// 表示用の画像プロキシ: 楽天画像を取得→焼き込み文字を背景色で消去(imageCleanup)→JPEGで返す。
// 各画像は初回だけ処理し、以降は CDN/ブラウザキャッシュ（immutable・1年）で配るのでコスト・遅延は初回のみ。
// GOOGLE_VISION_API_KEY 未設定 or 失敗時は cleanupBakedText が元画像を返す（=素通り・fail-open）。
// SSRF対策で楽天系ホストのみ許可。取得失敗時は元URLへ302（壊さない）。
export const runtime = "nodejs";

// 楽天の画像CDNホストのみ許可（rakuten.co.jp / r10s.jp 系）。
const ALLOW = /(^|\.)(rakuten\.co\.jp|r10s\.jp)$/i;

function allowedTarget(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol === "https:" && ALLOW.test(url.hostname)) return url.toString();
  } catch {
    /* invalid url */
  }
  return null;
}

const FETCH_HEADERS = {
  Referer: "https://www.yushutsu-fukugyo.com/",
  "User-Agent": "Mozilla/5.0",
};

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u") || "";
  const target = allowedTarget(u);
  if (!target) return new Response("bad url", { status: 400 });
  try {
    const r = await fetch(target, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return Response.redirect(target, 302); // 取得失敗 → 元画像へ
    const raw = Buffer.from(await r.arrayBuffer());
    const cleaned = await cleanupBakedText(raw); // 文字消去（キー無/失敗時は元のまま）
    const jpeg = await sharp(cleaned, { failOn: "none" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.redirect(target, 302); // fail-open: 元画像へ
  }
}
