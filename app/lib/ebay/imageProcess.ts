import sharp from "sharp";
import { uploadHostedPictureFromBinary } from "./eps";
import { epsLargeUrl } from "./epsUrl";
import { WATERMARK_PNG_B64 } from "./watermarkAsset";
import { cleanupBakedText } from "./imageCleanup";
import { upscaleImageflux } from "../usedGallery"; // ハードオフ画像CDN(imageflux)の小サムネURLを原寸級(1280px)に書き換える

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

// ユーザーの実物写真向け: 1600×1600の正方・白背景キャンバスに「全体を収める」(fit:contain)。
// ＝縦長/横長の写真でもeBayの正方グリッドで端が切れず商品全体が映る(フレーム内に収める)。白背景はeBay推奨。
// EXIF向き補正＋ダウンスケールで眠くなる分を軽くシャープ＋JPEG高品質。
export async function processRealPhoto(input: Buffer): Promise<Buffer> {
  return await sharp(input, { failOn: "none" })
    .rotate() // EXIF向き補正（縦で撮った写真が横にならないように）
    .resize(TARGET, TARGET, { fit: "contain", background: WHITE, kernel: sharp.kernel.lanczos3 })
    .flatten({ background: WHITE }) // 透過/わずかな色被りを白に
    .sharpen() // ダウンスケールで失われる輪郭を戻す（ボケ対策）
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

const FETCH_HEADERS = {
  Referer: "https://www.yushutsu-fukugyo.com/",
  Origin: "https://www.yushutsu-fukugyo.com",
  "User-Agent": "Mozilla/5.0",
};

// SSRF対策: 取得先は画像CDN(https・ハードオフ=imageflux.jp / 楽天レガシー=rakuten.co.jp・r10s.jp)のみ許可。
// ⚠️imageflux.jp を入れないとハードオフ画像を1枚も取得できず enhanceToEps が丸ごと不発→生の小サムネURLがeBayへ→
//   マスター極小(#25002/ボケ)。実ホストは p1-*.imageflux.jp のサブドメイン形式なので (^|\.) で網羅（末尾$アンカーで部分一致攻撃は防ぐ）。
// 内部/プライベートIPやメタデータ宛のサーバー発リクエストは https 限定＋FQDN完全一致で遮断。
// ※ /api/clean-img の ALLOW と同じ。変更時は両方そろえること。
const ALLOW_HOST = /(^|\.)(imageflux\.jp|rakuten\.co\.jp|r10s\.jp)$/i;
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
      // ハードオフ(imageflux)は取得前にURLを原寸級(1280px)へ書き換える＝検索サムネ(w=231)を掴んで1600へ拡大＝ボケるのを防ぎ、
      // CDNが実寸1280pxを返す＝本物の高解像度でEPS再ホストできる。楽天/その他URLは upscaleImageflux が素通り(無変更)。
      const raw = await fetchImage(upscaleImageflux(url));
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

// ── 出品中の画像を1枚ずつ「加工」してEPSへ再ホストする（編集モーダルの加工ボタン用） ──
// 既存の出品画像は EPS(ebayimg.com) か仕入れ元(ハードオフ=imageflux / 楽天レガシー=rakuten・r10s) か自サイトのプロキシにある。これらだけ取得を許可（SSRF対策）。
const LISTING_IMG_ALLOW = /(^|\.)(ebayimg\.com|imageflux\.jp|rakuten\.co\.jp|r10s\.jp|yushutsu-fukugyo\.com)$/i;
async function fetchListingImage(url: string): Promise<Buffer | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !LISTING_IMG_ALLOW.test(u.hostname)) return null;
  } catch { return null; }
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return ab.byteLength ? Buffer.from(ab) : null;
  } catch { return null; }
}

export type PhotoOp = "rotate90" | "rotate-90" | "crop" | "textremove";
// 1枚の出品画像を加工→1600px正方化(processRealPhoto)→EPSへ上げ、新しいEPS URLを返す。
// crop は {x,y,w,h}=元画像に対する0〜1の割合（クライアントのドラッグ枠から算出）。
export async function transformListingImage(
  token: string,
  srcUrl: string,
  op: PhotoOp,
  crop?: { x: number; y: number; w: number; h: number }
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const raw = await fetchListingImage(upscaleImageflux(epsLargeUrl(srcUrl))); // EPSはs-l1600・ハードオフ(imageflux)は1280へ書き換えてから取得して加工する
  if (!raw) return { ok: false, error: "画像を取得できませんでした。" };
  let buf: Buffer = raw;
  try {
    if (op === "rotate90") buf = await sharp(raw, { failOn: "none" }).rotate(90).toBuffer();
    else if (op === "rotate-90") buf = await sharp(raw, { failOn: "none" }).rotate(-90).toBuffer();
    else if (op === "crop" && crop) {
      const meta = await sharp(raw).metadata();
      const W = meta.width ?? 0, H = meta.height ?? 0;
      const left = Math.max(0, Math.min(W - 1, Math.round(crop.x * W)));
      const top = Math.max(0, Math.min(H - 1, Math.round(crop.y * H)));
      const width = Math.max(1, Math.min(W - left, Math.round(crop.w * W)));
      const height = Math.max(1, Math.min(H - top, Math.round(crop.h * H)));
      // 切り抜き後の長辺が500px未満だとeBayの最小解像度を割り、拡大でボケる→事前に弾いて案内する。
      if (Math.max(width, height) < 500) throw new Error("切り抜き範囲が小さすぎます（切り抜き後の長辺が500px以上必要）。範囲を広げるか、より大きい元写真を使ってください。");
      buf = await sharp(raw, { failOn: "none" }).extract({ left, top, width, height }).toBuffer();
    } else if (op === "textremove") {
      buf = await cleanupBakedText(raw); // Vision焼き込み文字消去（キー未設定/失敗時は素通り）
    }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "加工に失敗しました。" }; // sharp/Visionの生エラーを表に出す（diagに記録される）
  }
  const norm = await processRealPhoto(buf); // 1600px・JPEG・EXIF補正で規格統一
  const up = await uploadHostedPictureFromBinary(token, norm, "image/jpeg", "rr-edit");
  return up.ok && up.fullUrl ? { ok: true, url: up.fullUrl } : { ok: false, error: up.error || "アップロードに失敗しました。" };
}
