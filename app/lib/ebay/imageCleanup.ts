import sharp from "sharp";

// 出品画像に焼き込まれた「文字」を消す（背景色に同化）。
// 方式A（安全）: Google Cloud Vision の TEXT_DETECTION で文字の矩形を取得し、その領域だけを
// 周囲の背景色で塗りつぶす。生成AIで描き直さない＝商品本体は一切変えない（リセールで偽装にならない）。
//
// 有効化: 環境変数 GOOGLE_VISION_API_KEY を設定（Vision API を有効化したAPIキー）。
//   無効化したいときは IMAGE_TEXT_CLEANUP=0。キー未設定なら何もせず元画像を返す（非破壊）。
// 制約: 文字を含まない画像だけのロゴはOCRで拾えないため対象外。失敗時は元画像にフォールバック（fail-open）。

const VISION_KEY = process.env.GOOGLE_VISION_API_KEY || "";

type Box = { x0: number; y0: number; x1: number; y1: number };

interface VisionVertex { x?: number; y?: number }
interface VisionAnno { boundingPoly?: { vertices?: VisionVertex[] } }

// Vision TEXT_DETECTION で単語単位の外接矩形を取得（[0]は全文の外接矩形なので除外）。
async function detectTextBoxes(b64: string): Promise<Box[]> {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [{ image: { content: b64 }, features: [{ type: "TEXT_DETECTION" }] }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const d = await res.json();
  const annos: VisionAnno[] = d?.responses?.[0]?.textAnnotations ?? [];
  return annos
    .slice(1)
    .map((a) => {
      const vs = a.boundingPoly?.vertices ?? [];
      const xs = vs.map((v) => v.x ?? 0);
      const ys = vs.map((v) => v.y ?? 0);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    })
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
}

// 矩形の外周をサンプリングし、背景色（チャンネルごとのmedian）を返す。テキスト自身の色に引っ張られないようmedian。
function sampleBg(data: Buffer, W: number, H: number, ch: number, box: Box): [number, number, number] {
  const pad = 2;
  const stepX = Math.max(1, Math.floor((box.x1 - box.x0) / 8));
  const stepY = Math.max(1, Math.floor((box.y1 - box.y0) / 4));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (x: number, y: number) => {
    const cx = Math.min(W - 1, Math.max(0, x));
    const cy = Math.min(H - 1, Math.max(0, y));
    const i = (cy * W + cx) * ch;
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  };
  for (let x = box.x0 - pad; x <= box.x1 + pad; x += stepX) { push(x, box.y0 - pad); push(x, box.y1 + pad); }
  for (let y = box.y0 - pad; y <= box.y1 + pad; y += stepY) { push(box.x0 - pad, y); push(box.x1 + pad, y); }
  if (!rs.length) return [255, 255, 255];
  const med = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return [med(rs), med(gs), med(bs)];
}

// 文字を背景色で塗りつぶした画像を返す。キー未設定・文字なし・失敗時は元画像（非破壊）。
export async function cleanupBakedText(input: Buffer): Promise<Buffer> {
  if (!VISION_KEY || process.env.IMAGE_TEXT_CLEANUP === "0") return input;
  try {
    // EXIF向きを焼き込んでから処理（OCR座標と塗り座標を一致させる）。
    const oriented = await sharp(input, { failOn: "none" }).rotate().toBuffer();
    const boxes = await detectTextBoxes(oriented.toString("base64"));
    if (!boxes.length) return oriented;
    const { data, info } = await sharp(oriented).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, ch = info.channels;
    // 文字が画像の大半を占める＝そもそも商品写真でない可能性。塗っても無意味なので元画像。
    const area = boxes.reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
    if (area > W * H * 0.45) return oriented;
    const rects = boxes
      .map((b) => {
        const [r, g, bl] = sampleBg(data, W, H, ch, b);
        const p = Math.max(2, Math.round((b.y1 - b.y0) * 0.18));
        const x = Math.max(0, b.x0 - p), y = Math.max(0, b.y0 - p);
        const w = Math.min(W - x, (b.x1 - b.x0) + p * 2), h = Math.min(H - y, (b.y1 - b.y0) + p * 2);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${r},${g},${bl})"/>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`;
    return await sharp(oriented).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer();
  } catch {
    return input; // fail-open: 何かあれば元画像のまま出品
  }
}
