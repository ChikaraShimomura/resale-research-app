#!/usr/bin/env node
// scripts/audit_catalog.mjs — 本番カタログの精度を「独立した強い審判(Sonnet)」で実測監査する。
// カタログはHaiku→Sonnet合議の出力なので、同じ照合を再実行しても追認になるだけ。そこで:
//  本番で実際にマッチさせたeBay商品(matchedEbay*)に対し、楽天画像 ⇄ eBay画像 を Sonnet が
//  「むしろ別物である証拠を探す」敵対的プロンプトで再判定する。YES=同一/NO=別物。
//  matchedEbay* が無い旧データだけ、coreKeyword で eBay現行最安を引き直してフォールバック判定する。
//  サンプルは層別（新着 / realCount==1 / 全体・各40件）で、増数で増える尾も必ず測る。
// 結果は stdout の AUDIT_RESULTS_START/END の間にJSONで出す（CIログから回収）。本番KVには触れない。

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PRODUCTS_URL = process.env.PRODUCTS_URL || "https://www.yushutsu-fukugyo.com/api/products";
const USD = 155, GBP = 197, AUD = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _g = Promise.resolve();
const gate = () => { const w = _g; _g = w.then(() => sleep(1200)); return w; };
const toJpy = (v, c) => !v || v <= 0 ? 0 : c === "USD" ? Math.round(v * USD) : c === "GBP" ? Math.round(v * GBP) : c === "AUD" ? Math.round(v * AUD) : c === "JPY" ? Math.round(v) : 0;
const upscaleRakuten = (u) => (u || "").replace(/_ex=\d+x\d+/, "_ex=600x600");
const upscaleEbay = (u) => (u || "").replace(/s-l\d{2,4}/i, "s-l800");

let tok = null;
async function ebayToken() {
  if (tok && Date.now() < tok.exp) return tok.t;
  const enc = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${enc}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  const d = await res.json();
  tok = { t: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return d.access_token;
}
// 本体でない別売アクセサリ/部品・セットは比較対象にしない（最安に紛れるLEDユニット等で誤DIFFを防ぐ）。
const AUDIT_SKIP_RE = /\b(led unit|led set|action base|display base|stand only|expansion set|option parts|parts only|water[\s-]?decal|decal set|sticker sheet|photo[\s-]?etch|metal parts|conversion kit|garage kit|empty box|box only|outer box|manual only|instruction manual|lot of \d|set of \d|\d+\s*pcs|bundle|joblot)\b/i;
async function ebayTop(keyword) {
  const t = await ebayToken();
  const params = new URLSearchParams({ q: (keyword || "").slice(0, 120), filter: "conditions:{NEW|LIKE_NEW}", sort: "price", limit: "5" });
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!res.ok) return null;
  const d = await res.json();
  for (const it of d.itemSummaries ?? []) {
    const img = it.image?.imageUrl ?? it.thumbnailImages?.[0]?.imageUrl;
    if (img && it.title && !AUDIT_SKIP_RE.test(it.title)) return { title: it.title, img, priceJpy: toJpy(parseFloat(it.price?.value), it.price?.currency), url: it.itemWebUrl };
  }
  return null;
}

function auditPrompt(rakutenTitle, ebayTitle) {
  return `You are an adversarial QA auditor for a Japan→eBay resale tool. Two photos are shown.
Image1 = Rakuten(Japan) item, title "${(rakutenTitle || "").slice(0, 140)}".
Image2 = eBay item, title "${(ebayTitle || "").slice(0, 140)}".
Your job is to find any reason they are NOT the exact same sellable product. Be skeptical.
Check: same character/model number/card number/grade(HG/RG/MG/PG)/edition/volume(ml,g)/color; a genuine item is NOT a compatible/aftermarket part; a single is NOT a set/box/lot; accessory(case/sleeve/stand) is NOT the product itself.
If any distinguishing identifier cannot be confirmed in BOTH, do NOT assume same — set CONFIDENCE: LOW.
Reply EXACTLY:
SAME: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}

async function judge(rImg, eImg, rTitle, eTitle) {
  try {
    const [a, b] = await Promise.all([fetch(upscaleRakuten(rImg), { signal: AbortSignal.timeout(8000) }), fetch(upscaleEbay(eImg), { signal: AbortSignal.timeout(8000) })]);
    if (!a.ok || !b.ok) return { same: null, text: "image fetch failed" };
    const [ab, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    await gate();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 200, temperature: 0,
        messages: [{ role: "user", content: [
          { type: "text", text: auditPrompt(rTitle, eTitle) },
          { type: "image", source: { type: "base64", media_type: a.headers.get("content-type") ?? "image/jpeg", data: Buffer.from(ab).toString("base64") } },
          { type: "image", source: { type: "base64", media_type: b.headers.get("content-type") ?? "image/jpeg", data: Buffer.from(bb).toString("base64") } },
        ]}],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { same: null, text: `HTTP ${res.status}` };
    const d = await res.json();
    const t = d?.content?.[0]?.text ?? "";
    const same = /SAME:\s*YES/i.test(t) && !/CONFIDENCE:\s*LOW/i.test(t);
    return { same, text: t.replace(/\s+/g, " ").trim() };
  } catch (e) { return { same: null, text: `ERR ${e.message}` }; }
}

// SAME/(SAME+DIFFERENT) を % で。母数(判定できた数)が0なら null。
function precisionOf(rows) {
  const same = rows.filter((x) => x.verdict === "SAME").length;
  const diff = rows.filter((x) => x.verdict === "DIFFERENT").length;
  const denom = same + diff;
  return { same, diff, denom, pct: denom ? Math.round((same / denom) * 1000) / 10 : null };
}

const SAMPLE_N = 40; // 各層の最低サンプル数

(async () => {
  const cat = await fetch(PRODUCTS_URL).then((r) => r.json()).catch(() => null);
  const all = cat?.products ?? cat ?? [];
  console.error(`catalog: ${all.length} products total`);

  // 層別サンプリング：①新着(addedAt降順) ②realCount==1(増数で増える尾) ③全体先頭、を各40件。重複はID統合。
  // 件数を増やすと realCount==1 と新着が増えるので、そこを必ず測れるようにする（slice(0,40)の穴を塞ぐ）。
  const recent = [...all].sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || ""))).slice(0, SAMPLE_N);
  const rc1 = all.filter((p) => Number(p.realCount) === 1).slice(0, SAMPLE_N);
  const general = all.slice(0, SAMPLE_N);
  const recentIds = new Set(recent.map((p) => p.id));
  const byId = new Map();
  for (const p of [...recent, ...rc1, ...general]) if (!byId.has(p.id)) byId.set(p.id, p);
  const sample = [...byId.values()];
  console.error(`sample: ${sample.length} (recent=${recent.length}, realCount1=${rc1.length}, general=${general.length})`);

  const out = [];
  for (const p of sample) {
    // 本番で実際にマッチさせた組(matchedEbay*)を優先して採点。無い(旧)商品だけ現行eBayから引き直す。
    let eImg = p.matchedEbayImageUrl, eTitle = p.matchedEbayTitle || "", eUrl = p.matchedEbayUrl || "", src = "matched";
    if (!eImg) {
      const top = await ebayTop(p.coreKeyword || p.title);
      if (!top) {
        out.push({ id: p.id, cat: p.category, title: p.title, verdict: "NO_EBAY", reason: "eBay候補なし(現行)", realCount: p.realCount, addedAt: p.addedAt, src: "none" });
        console.error(`[${p.category}] ${(p.title || "").slice(0, 28)} -> no ebay`);
        continue;
      }
      eImg = top.img; eTitle = top.title; eUrl = top.url; src = "ebayTop";
    }
    const v = await judge(p.imageUrl, eImg, p.title, eTitle);
    out.push({
      id: p.id, cat: p.category, title: p.title, coreKeyword: p.coreKeyword,
      ebayTitle: eTitle, ebayUrl: eUrl, src, realCount: p.realCount, addedAt: p.addedAt, realAvgPrice: p.realAvgPrice,
      verdict: v.same === null ? "UNKNOWN" : v.same ? "SAME" : "DIFFERENT", reason: v.text,
    });
    console.error(`[${p.category}] ${(p.title || "").slice(0, 26)} -> ${v.same === null ? "?" : v.same ? "SAME" : "DIFF"} (${src})`);
  }

  console.log("AUDIT_RESULTS_START");
  console.log(JSON.stringify(out));
  console.log("AUDIT_RESULTS_END");

  const overall = precisionOf(out);
  const rc1P = precisionOf(out.filter((x) => Number(x.realCount) === 1));
  const recentP = precisionOf(out.filter((x) => recentIds.has(x.id)));
  const matchedP = precisionOf(out.filter((x) => x.src === "matched"));
  const noeb = out.filter((x) => x.verdict === "NO_EBAY" || x.verdict === "UNKNOWN").length;
  console.error(`\nPRECISION overall: SAME=${overall.same} DIFFERENT=${overall.diff} -> ${overall.pct}% (NO_EBAY/UNKNOWN=${noeb}, n=${out.length})`);
  console.error(`PRECISION realCount==1: ${rc1P.pct}% (n=${rc1P.denom})`);
  console.error(`PRECISION recent(addedAt): ${recentP.pct}% (n=${recentP.denom})`);
  console.error(`PRECISION matched-pair(stored): ${matchedP.pct}% (n=${matchedP.denom}) ／ ebayTop再取得(旧): ${precisionOf(out.filter((x) => x.src === "ebayTop")).pct}%`);
  console.error(`\n合格ライン: overall・realCount==1・recent すべて >=95%（2回連続）`);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
