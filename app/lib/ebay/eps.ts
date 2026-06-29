// eBay Picture Services (EPS) へ画像をアップロードするクライアント（Trading API: UploadSiteHostedPictures）。
// OAuth の User access token を X-EBAY-API-IAF-TOKEN ヘッダに載せて呼ぶ（RequesterCredentials は使わない）。
// 返る FullURL（i.ebayimg.com）を Sell Inventory API の inventory_item.product.imageUrls に使える。
// ※1出品内で「EPS画像」と「外部ホスト画像」は混在不可なので、外部画像も ExternalPictureURL で
//   EPS化して全EPSに統一する（このファイルの fromUrl）。

import { epsLargeUrl } from "./epsUrl";

const ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const TRADING_API = ENV === "sandbox" ? "https://api.sandbox.ebay.com/ws/api.dll" : "https://api.ebay.com/ws/api.dll";
// Trading API のスキーマ世代。古すぎると挙動差が出るため現行の安定値を固定。
const COMPAT_LEVEL = "1193";

export interface EpsResult {
  ok: boolean;
  fullUrl?: string;
  error?: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildRequestXml(opts: { name?: string; externalUrl?: string }): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    (opts.name ? `<PictureName>${escapeXml(opts.name)}</PictureName>` : "") +
    // Supersize＝フル解像度(最大1600px)＋ズーム対応で配信。Standardだと縮小版が返り画質が落ちる(eBay低画質の定番原因)。
    // 800px未満の小さい画像はeBay側が自動でStandardにフォールバックするので安全。
    `<PictureSet>Supersize</PictureSet>` +
    (opts.externalUrl ? `<ExternalPictureURL>${escapeXml(opts.externalUrl)}</ExternalPictureURL>` : "") +
    `</UploadSiteHostedPicturesRequest>`
  );
}

function tradingHeaders(token: string): Record<string, string> {
  return {
    "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
    "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
    "X-EBAY-API-SITEID": "0",
    "X-EBAY-API-IAF-TOKEN": token,
    "X-EBAY-API-DETAIL-LEVEL": "0",
  };
}

function parseEps(xml: string): EpsResult {
  const ack = /<Ack>(.*?)<\/Ack>/.exec(xml)?.[1] ?? "";
  const full = /<FullURL>(.*?)<\/FullURL>/.exec(xml)?.[1];
  // FullURLは既定で小さい変種(s-l500等)が返ることがある→s-l1600に正規化してフル解像度で保存/配信する。
  if (full && (ack === "Success" || ack === "Warning")) return { ok: true, fullUrl: epsLargeUrl(full) };
  const long = /<LongMessage>([\s\S]*?)<\/LongMessage>/.exec(xml)?.[1];
  const short = /<ShortMessage>([\s\S]*?)<\/ShortMessage>/.exec(xml)?.[1];
  const code = /<ErrorCode>(.*?)<\/ErrorCode>/.exec(xml)?.[1];
  // 12MB超(190201)/形式不正(190200)はユーザー向け文言に寄せる。
  if (code === "190201") return { ok: false, error: "画像サイズが大きすぎます（1枚12MBまで）。" };
  if (code === "190200") return { ok: false, error: "対応していない画像形式です（JPG/PNG/GIF/BMP/TIFF）。" };
  return { ok: false, error: [long || short, code && `#${code}`].filter(Boolean).join(" ") || "画像アップロードに失敗しました。" };
}

// 公開URL（例: 仕入れ元の商品画像）を eBay にフェッチさせて EPS 化する（バイナリ送信なし）。
export async function uploadHostedPictureFromUrl(token: string, externalUrl: string, name?: string): Promise<EpsResult> {
  try {
    const res = await fetch(TRADING_API, {
      method: "POST",
      headers: { ...tradingHeaders(token), "Content-Type": "text/xml; charset=utf-8" },
      body: buildRequestXml({ name, externalUrl }),
      signal: AbortSignal.timeout(30000),
    });
    return parseEps(await res.text());
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// 画像バイナリ（ユーザーがアップロードした実物写真）を multipart/form-data で EPS にアップロード。
export async function uploadHostedPictureFromBinary(
  token: string,
  bytes: Uint8Array,
  contentType: string,
  name?: string
): Promise<EpsResult> {
  try {
    const boundary = "rrEPS" + crypto.randomUUID().replace(/-/g, "");
    const pre = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="XML Payload"\r\n` +
        `Content-Type: text/xml; charset=utf-8\r\n\r\n` +
        buildRequestXml({ name }) +
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="image"\r\n` +
        `Content-Transfer-Encoding: binary\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
      "utf-8"
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    const body = Buffer.concat([pre, Buffer.from(bytes), post]);
    const res = await fetch(TRADING_API, {
      method: "POST",
      headers: { ...tradingHeaders(token), "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(45000),
    });
    return parseEps(await res.text());
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
