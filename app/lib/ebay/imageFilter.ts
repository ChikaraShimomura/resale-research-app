// 楽天ギャラリー画像から「商品が写った写真」を選ぶ（複数画像出品用）。
// 文字/小ロゴ/隅のバナーが乗っていても採用し（焼き込み文字は imageCleanup で後段に背景色で消す）、
// 除外するのは「商品が写っていない店の装飾画像（バナー/サイズ表/クーポン/全面テキスト）」と「透かしが商品全体に被った画像」。
// ①ファイル名ヒント(無料・明白な装飾だけ事前除外) ②Haikuビジョン判定。
import { kv } from "@vercel/kv";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ファイル名やパスに含まれがちな「店の装飾/案内」ワード（無料の事前フィルタ）。
const JUNK_HINT =
  /soryo|送料|free.?ship|sale|campaign|ivent|event|banner|logo|header|footer|toppage|info|setsumei|説明|guide|chart|size|サイズ|coupon|クーポン|qr|point|ポイント|review|レビュー|notice|caution|attention/i;

// 楽天サムネ(リサイズCDN)→ 原寸オリジナル。出品画像のボケ低減と同じ変換。
function toOriginal(url: string): string {
  if (/thumbnail\.image\.rakuten\.co\.jp\/@0_mall\//.test(url)) {
    return url.replace("thumbnail.image.rakuten.co.jp/@0_mall/", "image.rakuten.co.jp/").replace(/\?_ex=\d+x\d+/, "");
  }
  return url.replace(/_ex=\d+x\d+/, "_ex=1200x1200");
}

function hashUrl(u: string): string {
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (Math.imul(h, 31) + u.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// 1枚が「商品写真(PRODUCT)」か「店の装飾(JUNK)」かをHaikuで判定。KVキャッシュ(30日)。失敗時は採用＝載せる(安全側)。
async function isProductPhoto(url: string): Promise<boolean> {
  if (!ANTHROPIC_API_KEY) return true;
  const key = `imgjunk:${hashUrl(url)}`;
  try {
    const cached = await kv.get<string>(key);
    if (cached === "P") return true;
    if (cached === "J") return false;
  } catch {
    /* キャッシュ不通は無視 */
  }
  try {
    const img = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!img.ok) return true;
    const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
    const mt = img.headers.get("content-type") ?? "image/jpeg";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 5,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Does this image show the actual product itself? Overlaid text, a price/shipping banner, or a small store logo are fine — answer PRODUCT (such text gets cleaned up later). Answer JUNK only if it does NOT show the product (it is purely a store banner, a size chart, a coupon, or an all-text promo), OR if a watermark is stamped/tiled across the whole product. Answer with ONE word: PRODUCT or JUNK.",
              },
              { type: "image", source: { type: "base64", media_type: mt, data: b64 } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return true;
    const d = await res.json();
    const ans = (d?.content?.[0]?.text ?? "").toUpperCase();
    const isProduct = !ans.includes("JUNK");
    try {
      await kv.set(key, isProduct ? "P" : "J", { ex: 30 * 24 * 3600 });
    } catch {
      /* キャッシュ保存失敗は無視 */
    }
    return isProduct;
  } catch {
    return true; // 取得/判定失敗 → 載せる(安全側)
  }
}

// 商品写真だけを原寸URLで返す。最大 maxKeep 枚。空なら呼び出し側で代表画像にフォールバック。
export async function filterProductImages(urls: string[], maxKeep = 6): Promise<string[]> {
  const uniq = [...new Set((urls || []).filter(Boolean))].slice(0, 5); // 楽天APIは最大3だが安全側で5まで
  const kept: string[] = [];
  for (const u of uniq) {
    if (JUNK_HINT.test(u)) continue; // 無料の事前フィルタ
    if (await isProductPhoto(u)) kept.push(toOriginal(u));
    if (kept.length >= maxKeep) break;
  }
  return kept;
}
