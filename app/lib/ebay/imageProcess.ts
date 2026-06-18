import sharp from "sharp";
import { uploadHostedPictureFromBinary } from "./eps";

// 出品画像の品質底上げ（無料・Node sharp）。
// eBayのズーム(長辺800px以上で作動・1600px推奨)を解放＋検索グリッド最適化(正方1:1)＋
// 透過/暗さを白背景・シャープで「商品写真」らしく整える。sharp は Next が自動でバンドル除外(ネイティブrequire)。
const TARGET = 1600;
const WHITE = { r: 255, g: 255, b: 255 } as const;

// 自動掲載の楽天画像向け: 1600x1600 の正方・白背景キャンバスに収め、軽くシャープ→JPEG。
export async function processListingImage(input: Buffer): Promise<Buffer> {
  return await sharp(input, { failOn: "none" })
    .rotate() // EXIF向き補正
    .resize(TARGET, TARGET, { fit: "contain", background: WHITE, kernel: sharp.kernel.lanczos3 })
    .flatten({ background: WHITE }) // 透過/わずかな色被りを白に
    .sharpen()
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
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

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return ab.byteLength ? Buffer.from(ab) : null;
  } catch {
    return null;
  }
}

// 楽天画像URL群を「取得→1600px正方白背景に加工→EPSアップロード」し、出品に使うEPS URL群を返す。
// 1枚でも成功すれば全EPS(自前URLとの混在を回避)。全滅なら null を返し、呼び出し側は元URLにフォールバック(fail-open)。
export async function enhanceToEps(token: string, urls: string[]): Promise<string[] | null> {
  if (process.env.LISTING_IMAGE_ENHANCE === "0") return null; // 緊急停止スイッチ(既定ON)
  if (!urls.length) return null;
  const results = await Promise.all(
    urls.map(async (url) => {
      const raw = await fetchImage(url);
      if (!raw) return null;
      let processed: Buffer;
      try {
        processed = await processListingImage(raw);
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
