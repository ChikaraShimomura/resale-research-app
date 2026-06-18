// 透かしアセット生成: app/lib/ebay/watermarkAsset.ts(base64 PNG) を作る。
// サーバーレス(Vercel)はフォントが無くSVGテキストが描けないことがあるため、フォントのあるローカルで
// 先にPNG化して base64 で埋め込む。ブランド名を変えたら TEXT を変えて再実行するだけ。
import sharp from "sharp";
import { writeFileSync } from "fs";

const TEXT = process.env.WM_TEXT || "Premium Japan Export";
// 半透明の濃いグレー文字（白背景・写真どちらでも控えめに読める）。透明背景。
const svg = `<svg width="960" height="110" xmlns="http://www.w3.org/2000/svg"><text x="480" y="74" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700" fill="#3a3a3a" fill-opacity="0.5">${TEXT}</text></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(
  "app/lib/ebay/watermarkAsset.ts",
  `// 自動生成(scripts/genWatermark.mjs)。透かし文字「${TEXT}」の半透明PNG(base64)。名前を変えたら再生成。\nexport const WATERMARK_PNG_B64 =\n  "${png.toString("base64")}";\n`
);
console.log("watermark png bytes:", png.length);
