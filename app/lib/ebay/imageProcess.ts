import sharp from "sharp";
import { uploadHostedPictureFromBinary } from "./eps";
import { WATERMARK_PNG_B64 } from "./watermarkAsset";
import { cleanupBakedText } from "./imageCleanup";

// 出品画像の品質底上げ（無料・Node sharp）。
// eBayのズーム(長辺800px以上で作動・1600px推奨)を解放＋検索グリッド最適化(正方1:1)＋
// 透過/暗さを白背景・シャープで「商品写真」らしく整える。sharp は Next が自動でバンドル除外(ネイティブrequire)。
const TARGET = 1600;
const WHITE = { r: 255, g: 255, b: 255 } as const;

// 透かし(自分のブランド名)。eBayの出品者ID/ストア名と一致させて使う前提で env LISTING_WATERMARK=1 のときON(既定OFF)。
// 規約上グレーなので最小・控えめ＋サブ画像のみ(メイン=検索表示直結には付けない)。リサイズ済みを1度だけ作りキャッシュ。
let wmCache: { buf: Buffer; w: number; h: number } | null = null;
async function getWatermark(): Promise<{ buf: Buffer; w: number; h: number } | null> {
  if (wmCache) return wmCache;
  try {
    const width = Math.round(TARGET * 0.34); // 画像幅の約34%(控えめ)
    const buf = await sharp(Buffer.from(WATERMARK_PNG_B64, "base64")).resize({ width }).png().toBuffer();
    const meta = await sharp(buf).metadata();
    wmCache = { buf, w: meta.width ?? width, h: meta.height ?? Math.round(width * 0.11) };
    return wmCache;
  } catch {
    return null;
  }
}

// 自動掲載のカタログ画像向け: 1600x1600 の正方・白背景キャンバスに収め、軽くシャープ→JPEG。
// opts.watermark=true のときだけ右下隅に控えめなブランド名透かしを合成(サブ画像用)。
export async function processListingImage(input: Buffer, opts?: { watermark?: boolean }): Promise<Buffer> {
  let img = sharp(input, { failOn: "none" })
    .rotate() // EXIF向き補正
    .resize(TARGET, TARGET, { fit: "contain", background: WHITE, kernel: sharp.kernel.lanczos3 })
    .flatten({ background: WHITE }) // 透過/わずかな色被りを白に
    .sharpen();
  if (opts?.watermark) {
    const wm = await getWatermark();
    if (wm) {
      const margin = Math.round(TARGET * 0.025);
      img = img.composite([{ input: wm.buf, top: TARGET - wm.h - margin, left: TARGET - wm.w - margin }]);
    }
  }
  return await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

// ユーザーの実物写真向け: 構図は変えず長辺1600pxへ収め(12MB超のスマホ写真対策)＋JPEG最適化。
export async function processRealPhoto(input: Buffer): Promise<Buffer> {
  return await sharp(input, { failOn: "none" })
    .rotate()
    .resize(TARGET, TARGET, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

const FETCH_HEADERS = {
  Referer: "https://www.yushutsu-fukugyo.com/",
  Origin: "https://www.yushutsu-fukugyo.com",
  "User-Agent": "Mozilla/5.0",
};

// SSRF対策: 取得先はレガシー画像CDN(https・rakuten.co.jp / r10s.jp 系)のみ許可。
// 旧カタログ画像の表示に必要なため許可リストとして残す。内部/プライベートIPやメタデータ宛のサーバー発リクエストを遮断。
// ※ /api/clean-img の ALLOW と同じ。変更時は両方そろえること。
const ALLOW_HOST = /(^|\.)(rakuten\.co\.jp|r10s\.jp)$/i;
function isAllowedImageUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && ALLOW_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  if (!isAllowedImageUrl(url)) return null; // 許可外ホストは取得しない（SSRF遮断・出品は元URLにフォールバック）
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return ab.byteLength ? Buffer.from(ab) : null;
  } catch {
    return null;
  }
}

// 画像URL群を「取得→1600px正方白背景に加工→EPSアップロード」し、出品に使うEPS URL群を返す。
// 1枚でも成功すれば全EPS(自前URLとの混在を回避)。全滅なら null を返し、呼び出し側は元URLにフォールバック(fail-open)。
export async function enhanceToEps(token: string, urls: string[]): Promise<string[] | null> {
  if (process.env.LISTING_IMAGE_ENHANCE === "0") return null; // 緊急停止スイッチ(既定ON)
  if (!urls.length) return null;
  const wmOn = process.env.LISTING_WATERMARK === "1"; // 透かしON(既定OFF)。メイン(i=0)には付けない。
  const results = await Promise.all(
    urls.map(async (url, i) => {
      const raw = await fetchImage(url);
      if (!raw) return null;
      let processed: Buffer;
      try {
        const cleaned = await cleanupBakedText(raw); // 焼き込み文字を背景色で消去（キー未設定・失敗時は素通り）
        processed = await processListingImage(cleaned, { watermark: wmOn && i > 0 });
      } catch {
        return null;
      }
      const up = await uploadHostedPictureFromBinary(token, processed, "image/jpeg", "rr-listing");
      return up.ok && up.fullUrl ? up.fullUrl : null;
    })
  );
  const eps = results.filter((u): u is string => !!u);
  return eps.length ? eps : null;
}
