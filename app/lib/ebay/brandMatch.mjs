// app/lib/ebay/brandMatch.mjs
// 型番なしブランド品カタログ用の共有ヘルパー（Anthropic）。2機能を提供:
//  1) jaToEnglishBrandQuery(brand,name,cat) : 日本語ブランド品名 → できるだけ限定的な英語eBay検索クエリ
//  2) imageSameProduct(urlA,urlB,{titleA,titleB}) : 2画像が「同一の販売バリアント」か = 'same'|'different'|'unknown'
//
// ★ imageSameProduct は【fail-CLOSED】: 取得失敗/AI不通/確信不足は 'same' を返さず 'unknown'。
//    これは refresh.mjs の isImageMatch（除外フィルタ用でfail-OPEN=失敗時true）とは逆の設計。
//    新レールは「追加確定ゲート」なので、確認できないものを確定にしてはいけない（偽物/別物を載せない）。
//    プロンプトは refresh.mjs の実績品（識別子重視 strict → 敵対的 adversarial の2段）を流用。
//    確定は Haiku(下調べ) と Sonnet(敵対的確認) の両YESが揃った時だけ 'same'。
//
// env: ANTHROPIC_API_KEY（無ければ全機能 null/'unknown'＝新レール無効化が安全）/ KV_REST_API_URL+TOKEN（結果キャッシュ）/
//      BRAND_MATCH_HAIKU(既定 claude-haiku-4-5) / BRAND_MATCH_SONNET(既定 claude-sonnet-4-6)
import fs from "node:fs";

function envv(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const ANTHROPIC_API_KEY = envv("ANTHROPIC_API_KEY");
const KV_URL = envv("KV_REST_API_URL") || envv("UPSTASH_REDIS_REST_URL");
const KV_TOK = envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN");
const HAIKU = envv("BRAND_MATCH_HAIKU") || "claude-haiku-4-5";
const SONNET = envv("BRAND_MATCH_SONNET") || "claude-sonnet-4-6";

const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Anthropic連打を避ける最小ゲート（ワーカー側でも item 間 jitter があるが二重で保険）。
let lastCall = 0;
async function gate() { const wait = 350 - (Date.now() - lastCall); if (wait > 0) await sleep(wait); lastCall = Date.now(); }

async function kvGet(key) {
  if (!KV_URL || !KV_TOK) return null;
  try { const j = await (await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json(); return j.result ?? null; } catch { return null; }
}
async function kvSet(key, val, ttlSec) {
  if (!KV_URL || !KV_TOK) return;
  try { await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify([["SET", key, String(val), "EX", String(ttlSec)]]) }); } catch { /* best-effort */ }
}

// eBayの s-l{N} サムネを大判化して識別子(型番/ロゴ/型押し)を読めるように。ハードオフのimageflux原寸URLには無害。
const upscale = (url) => String(url || "").replace(/s-l\d{2,4}/i, "s-l800");

// ---- テキスト(JA→EN) ----
async function anthropicText(model, maxTokens, prompt) {
  if (!ANTHROPIC_API_KEY) return null;
  await gate();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() ?? null;
  } catch { return null; }
}

// 日本語ブランド品名 → 限定的な英語eBay検索クエリ。Haiku・30日キャッシュ。失敗/キー無しは null。
export async function jaToEnglishBrandQuery(brand, name, cat = "") {
  const jp = [brand, name].filter(Boolean).join(" ").trim();
  if (!jp) return null;
  const cacheKey = `en_brandq:${hashStr(jp)}`;
  const cached = await kvGet(cacheKey);
  if (cached) return cached;
  const text = await anthropicText(HAIKU, 40,
    `Convert this Japanese USED brand item into a short, SPECIFIC English eBay search query (max 6 words) to find the SAME product's sold listings.
Keep: the brand name (romanize, e.g. グッチ->Gucci), the product type (bag/wallet/watch/ring/necklace/jacket/sunglasses/etc.), the line/model name if present, and ONE distinguishing attribute (color OR material).
Drop: condition, shipping, seller words, sizes in cm, and all Japanese punctuation. Output ONLY the English query, nothing else.
Brand: "${brand || ""}"  Name: "${name || ""}"  Category: "${cat || ""}"`);
  if (!text) return null;
  const q = text.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (q.length < 3) return null;
  await kvSet(cacheKey, q, 30 * 24 * 3600);
  return q;
}

// ---- 画像(2枚→同一か) ----
function strictMatchPrompt(titleA, titleB) {
  return `You verify whether two photos show the EXACT SAME sellable product variant, for a used-goods resale price catalog. A wrong "same" misleads users about market price, so be conservative: if you cannot confirm the same specific variant, answer NO.
Image 1: source (Japan used shop). Title: "${(titleA || "").slice(0, 140)}".
Image 2: eBay sold listing. Title: "${(titleB || "").slice(0, 140)}".
Step 1 - For EACH image, read every identifier from the image AND its title: brand, product type, line/model name, model/style number, color, material, hardware, size.
Step 2 - Compare the SPECIFIC variant, not just the category:
 - Bags/wallets/accessories: same BRAND and same line/model (e.g. Gucci GG Marmont vs Gucci Dionysus = NO) and same size class (mini vs full) and same material/color family.
 - Apparel: same brand, item type, and (if visible) size class; a different silhouette/pattern = NO.
 - Watches/jewelry: same brand and model; a genuine branded item is NOT the same as a generic/compatible/aftermarket item; never declare genuine from the image alone.
 - Single vs set/lot/bundle must match.
 - Note: condition/wear/scratches do NOT change identity (a worn bag and a mint bag of the SAME model are the same variant). Do NOT answer NO merely due to condition differences.
Step 3 - If a distinguishing identifier (line/model/color/material) cannot be read in EITHER the image or the title, do NOT guess YES; set CONFIDENCE: LOW.
Reply EXACTLY in this format:
ID1: <the specific variant in image 1>
ID2: <the specific variant in image 2>
SAME_VARIANT: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}
function adversarialMatchPrompt(titleA, titleB) {
  return `You are an adversarial QA auditor confirming a Japan-used -> eBay resale match for a price catalog. Two photos are shown.
Image 1: source (Japan used shop). Title: "${(titleA || "").slice(0, 140)}".
Image 2: eBay sold listing. Title: "${(titleB || "").slice(0, 140)}".
Your job is to find ANY reason these are NOT the exact same sellable product variant. Be skeptical; the default is NO. A wrong "same" misleads users about price.
REJECT (answer NO) on any mismatch of: brand, product type, line/model name, style/model number, color, material, hardware, size class, or single-vs-set. A genuine item is NOT a compatible/aftermarket part. An accessory (dust bag/strap/box) is NOT the product itself.
IMPORTANT: condition/wear/scratches/accessories do NOT change product identity — do NOT reject solely because one looks more worn or lacks the box; judge IDENTITY only.
If a distinguishing identifier (line/model/color/material) cannot be CONFIRMED in BOTH the image and the title, do NOT assume same — set CONFIDENCE: LOW.
Reply EXACTLY in this format:
ID1: <the specific variant in image 1>
ID2: <the specific variant in image 2>
SAME_VARIANT: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}
const parseSame = (text) => /SAME_VARIANT:\s*YES/i.test(text) && !/CONFIDENCE:\s*LOW/i.test(text);

async function anthropicVision(model, prompt, img) {
  if (!ANTHROPIC_API_KEY) return null;
  await gate();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 220, temperature: 0,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image", source: { type: "base64", media_type: img.mt1, data: img.b1 } },
          { type: "image", source: { type: "base64", media_type: img.mt2, data: img.b2 } },
        ] }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.content?.[0]?.text ?? "";
  } catch { return null; }
}

/**
 * 2画像が「同一の販売バリアント」か。fail-CLOSED: 確認できない時は 'same' を返さない。
 * @returns {'same'|'different'|'unknown'} same=Haiku＆Sonnet両YES / different=どちらかがNO / unknown=取得失敗・AI不通・キー無し
 */
export async function imageSameProduct(urlA, urlB, { titleA = "", titleB = "" } = {}) {
  if (!ANTHROPIC_API_KEY || !urlA || !urlB) return "unknown";
  const cacheKey = `img_same:${hashStr(urlA + "|" + urlB)}`; // refreshのimg_match5(fail-open値)とは別キー＝意味の取り違え防止
  const cached = await kvGet(cacheKey);
  if (cached === "same" || cached === "different") return cached;

  let img;
  try {
    const [r1, r2] = await Promise.all([
      fetch(upscale(urlA), { signal: AbortSignal.timeout(8000) }),
      fetch(upscale(urlB), { signal: AbortSignal.timeout(8000) }),
    ]);
    if (!r1.ok || !r2.ok) return "unknown"; // 取得不可＝判定不能（fail-closed：確定にしない・キャッシュもしない）
    const [a1, a2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
    img = {
      b1: Buffer.from(a1).toString("base64"), mt1: r1.headers.get("content-type") || "image/jpeg",
      b2: Buffer.from(a2).toString("base64"), mt2: r2.headers.get("content-type") || "image/jpeg",
    };
  } catch { return "unknown"; }

  // A: Haiku 下調べ（識別子重視）。不通=unknown。NO=different（確定除外・キャッシュ）。
  const hai = await anthropicVision(HAIKU, strictMatchPrompt(titleA, titleB), img);
  if (hai === null) return "unknown";
  if (!parseSame(hai)) { await kvSet(cacheKey, "different", 720 * 3600); return "different"; }

  // B: Sonnet 敵対的確認（追加ゲートなので確認必須）。不通=unknown（採用しない＝fail-closed）。
  const son = await anthropicVision(SONNET, adversarialMatchPrompt(titleA, titleB), img);
  if (son === null) return "unknown";
  const same = parseSame(son);
  await kvSet(cacheKey, same ? "same" : "different", 720 * 3600);
  return same ? "same" : "different";
}
