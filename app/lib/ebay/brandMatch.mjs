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
import crypto from "node:crypto";

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

// ★Pixel等ローカルに ANTHROPIC_API_KEY が無い環境は、AI判定を Vercel の /api/internal/ai-brand 経由で実行する
//   （Vercelにはキーがある＝Pixelに秘密を増やさない）。認証は両者が持つ KV_REST_API_TOKEN の SHA-256（生トークンは送らない）。
const AI_PROXY_URL = envv("AI_PROXY_URL") || "https://www.yushutsu-fukugyo.com";
const USE_PROXY = !ANTHROPIC_API_KEY && !!KV_TOK; // キー無し＝Pixel → Vercel経由
const proxyAuth = () => (KV_TOK ? crypto.createHash("sha256").update(KV_TOK).digest("hex") : "");
async function callProxy(op, payload) {
  const auth = proxyAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`${AI_PROXY_URL}/api/internal/ai-brand`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-auth": auth },
      body: JSON.stringify({ op, ...payload }),
      signal: AbortSignal.timeout(50000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

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
  if (!ANTHROPIC_API_KEY) { // Pixel: Vercel経由（キャッシュはVercel側が書く）
    const r = USE_PROXY ? await callProxy("enquery", { brand, name, cat }) : null;
    return r && r.query ? r.query : null;
  }
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
  return `You verify whether two photos show the SAME product model, for a used-goods resale price catalog of BRANDED SECONDHAND items (bags, wallets, jewelry, apparel, accessories, cameras/gear). For most such goods the exact model NUMBER is NOT printed on the item, so judge by VISIBLE FEATURES, not by a printed code.
Image 1: source (Japan used shop). Title: "${(titleA || "").slice(0, 140)}".
Image 2: eBay sold listing. Title: "${(titleB || "").slice(0, 140)}".
Compare these VISIBLE features across BOTH photos and titles:
 - Brand (logo, hallmark, hardware, engraving, or stated in title) — must match.
 - Product type (necklace / shoulder bag / wallet / ring / jacket / lens ...) — must match.
 - Overall form & design (silhouette, shape, distinctive motif e.g. a heart pendant, quilting, monogram pattern) — must match.
 - Color family and material — must match.
 - Single vs set/lot/pair — must match.
Rules:
 - You do NOT need a printed model number. If brand + type + form + color/material clearly match, answer YES even when no model text is visible.
 - Condition/wear/scratches/missing box or accessories do NOT change identity — never answer NO due to condition.
 - Answer NO if brand, product type, overall form, color, or material clearly differ (e.g. Gucci GG Marmont vs Gucci Dionysus = NO; a genuine item vs a generic/aftermarket look-alike = NO).
 - Set CONFIDENCE: LOW ONLY if the photos are too unclear to compare the form, OR the brand cannot be established in either the photo or the title.
Reply EXACTLY in this format:
ID1: <what image 1 shows>
ID2: <what image 2 shows>
SAME_VARIANT: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}
function adversarialMatchPrompt(titleA, titleB) {
  return `You are an adversarial QA auditor confirming a Japan-used -> eBay resale match for a price catalog. Two photos of BRANDED SECONDHAND goods are shown. For most such goods the exact model NUMBER is NOT printed on the item — judge by VISIBLE FEATURES.
Image 1: source (Japan used shop). Title: "${(titleA || "").slice(0, 140)}".
Image 2: eBay sold listing. Title: "${(titleB || "").slice(0, 140)}".
Find any real reason these are NOT the same product model. Default to NO on a genuine mismatch.
REJECT (answer NO) if these clearly differ: brand, product type, overall form/silhouette/pattern/motif, color, material, or single-vs-set. A genuine item is NOT a compatible/aftermarket look-alike. An accessory (dust bag/strap/box) is NOT the product itself.
DO NOT reject for: condition/wear/scratches, missing box/accessories, different lighting or angle, or merely because no printed model number is visible.
If brand + product type + overall form + color/material match across the two photos, answer YES (a printed model code is NOT required).
Set CONFIDENCE: LOW ONLY if the photos are too unclear to compare, OR the brand cannot be established in either photo or title.
Reply EXACTLY in this format:
ID1: <what image 1 shows>
ID2: <what image 2 shows>
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
  if (!urlA || !urlB) return "unknown";
  const cacheKey = `img_same:${hashStr(urlA + "|" + urlB)}`; // refreshのimg_match5(fail-open値)とは別キー＝意味の取り違え防止
  const cached = await kvGet(cacheKey);
  if (cached === "same" || cached === "different") return cached;
  if (!ANTHROPIC_API_KEY) { // Pixel: Vercel経由（判定＆キャッシュはVercel側）
    const r = USE_PROXY ? await callProxy("imgmatch", { imageUrlA: urlA, imageUrlB: urlB, titleA, titleB }) : null;
    return r && (r.verdict === "same" || r.verdict === "different") ? r.verdict : "unknown";
  }

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
