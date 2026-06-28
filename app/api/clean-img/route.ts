import sharp from "sharp";
import { cleanupBakedText } from "../../lib/ebay/imageCleanup";
import { processListingImage } from "../../lib/ebay/imageProcess";

// 表示用の画像プロキシ: 仕入れ元の画像を取得→焼き込み文字を背景色で消去(imageCleanup)→JPEGで返す。
// 各画像は初回だけ処理し、以降は CDN/ブラウザキャッシュ（immutable・1年）で配るのでコスト・遅延は初回のみ。
// GOOGLE_VISION_API_KEY 未設定 or 失敗時は cleanupBakedText が元画像を返す（=素通り・fail-open）。
// SSRF対策で許可リストのホストのみ許可。取得失敗時は元URLへ302（壊さない）。
export const runtime = "nodejs";

// レガシー画像CDNホストのみ許可（rakuten.co.jp / r10s.jp 系・無在庫時代の画像表示に必要）。
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
  const sp = new URL(req.url).searchParams;
  const u = sp.get("u") || "";
  // list=1: eBay出品(enhanceToEps)と同じ processListingImage(1600px正方/白背景/シャープ)も通す＝出品画像と一致するプレビュー(WYSIWYG)。
  const listMode = sp.get("list") === "1";
  const target = allowedTarget(u);
  if (!target) return new Response("bad url", { status: 400 });
  try {
    const r = await fetch(target, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return Response.redirect(target, 302); // 取得失敗 → 元画像へ
    const raw = Buffer.from(await r.arrayBuffer());
    const cleaned = await cleanupBakedText(raw); // 文字消去（キー無/失敗時は元のまま）
    const out = listMode
      ? await processListingImage(cleaned) // eBay出品と同一加工＝WYSIWYG
      : await sharp(cleaned, { failOn: "none" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.redirect(target, 302); // fail-open: 元画像へ
  }
}
