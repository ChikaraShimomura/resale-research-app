#!/usr/bin/env node
// scripts/experiment.mjs — マッチング「順序」のA/B/Cバトル（本番カタログには一切触れない）。
// 同じジャンル土俵で 3戦略を回し、各ペア（楽天画像＋eBay画像つき）を出力する。
//   A: eBay-first（eBay種→和訳→楽天検索→画像一致）＝現行
//   B: 楽天-first（楽天実商品→英訳→eBay検索→画像一致）
//   C: 識別子アンカー（eBayの型番/番号で楽天を引き、番号一致＋画像一致）
// 結果は stdout に EXPERIMENT_RESULTS_START/END で囲んで JSON 出力（CIログから回収）。
// マッチャは全戦略で共通の Gemini(無料枠) を使い、順序の差だけを公平に比較する。

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const USD_TO_JPY = 155, GBP_TO_JPY = 197, AUD_TO_JPY = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 弱点ジャンル中心の種（eBay英語クエリ＋楽天和キーワード）。
const GENRES = [
  { cat: '腕時計', ebayQ: 'casio g-shock watch new japan', rakutenKw: 'G-SHOCK 腕時計 新品' },
  { cat: 'ゲーム', ebayQ: 'amiibo nintendo new japan sealed', rakutenKw: 'amiibo 新品' },
  { cat: 'コスメ', ebayQ: 'shiseido skincare japan new', rakutenKw: '資生堂 スキンケア 新品' },
  { cat: 'トレカ', ebayQ: 'pokemon card booster box japanese sealed', rakutenKw: 'ポケモンカード BOX 未開封' },
  { cat: 'フィギュア', ebayQ: 'nendoroid figure good smile new sealed', rakutenKw: 'ねんどろいど 新品' },
  { cat: 'ガンプラ', ebayQ: 'gunpla master grade bandai new', rakutenKw: 'ガンプラ MG 新品' },
  { cat: 'LEGO', ebayQ: 'lego set japan new sealed', rakutenKw: 'レゴ セット 新品' },
  { cat: 'おもちゃ', ebayQ: 'tomica diecast car japan new', rakutenKw: 'トミカ 新品' },
];
const PER_GENRE = 6;   // 各ジャンル×各戦略で扱う種数（コスト/時間の制御）
const CANDIDATES = 4;  // 各種につき試す相手候補数

// 除外パターン（refresh.mjs と同一）。
const EXCLUDE_PATTERN = /オリパ|ばら売り|パック売り|BOXくじ|ボックスくじ|くじ引き|ガチャ|オリジナルパック|アソート売り|\d+パック\s*(売り|のみ|セット)/i;
const ACCESSORY_EXCLUDE_PATTERN = /クリアケース|カードローダー|ローダー|カードスリーブ|スリーブ\d+枚|デッキケース|カードファイル|バインダー|カードバインダー|BOX保管|保管用|保護ケース|スタンド|ディスプレイケース|展示ケース/i;
const PART_EXCLUDE = /互換|社外|交換用|交換\s*(?:ベルト|バンド|ストラップ)|替え\s*(?:ベルト|バンド|ストラップ)|汎用|バネ棒|遊環|尾錠単体|NATO\s*(?:ベルト|ストラップ|バンド)|ZULU|(?:対応|適合|用)\s*(?:ベルト|バンド|ストラップ)/i;
const SET_EXCLUDE = /\d+\s*(?:点|個|本|体|枚)\s*セット|\d+\s*(?:点|個|本|体)\s*まとめ|まとめ売り|セット売り|\d+\s*個入り|詰め合わせ/i;
const excluded = (name) => EXCLUDE_PATTERN.test(name) || ACCESSORY_EXCLUDE_PATTERN.test(name) || PART_EXCLUDE.test(name) || SET_EXCLUDE.test(name);

function extractCodes(s) {
  const up = (s || '').toUpperCase();
  const m = up.match(/\b[A-Z]{1,4}-?\d{1,4}(?:[-/][A-Z0-9]{1,6})*\b/g) || [];
  return [...new Set(m.filter((c) => /\d/.test(c) && (/[-/]/.test(c) || /[A-Z]{2,}\d/.test(c))).map((c) => c.replace(/[^A-Z0-9]/g, '')))];
}
function codesConflict(a, b) {
  const ca = extractCodes(a), cb = extractCodes(b);
  if (!ca.length || !cb.length) return false;
  return !ca.some((x) => cb.some((y) => x === y || x.startsWith(y) || y.startsWith(x)));
}
function toJpy(v, c) {
  if (!v || v <= 0) return 0;
  if (c === 'USD') return Math.round(v * USD_TO_JPY);
  if (c === 'GBP') return Math.round(v * GBP_TO_JPY);
  if (c === 'AUD') return Math.round(v * AUD_TO_JPY);
  if (c === 'JPY') return Math.round(v);
  return 0;
}

let ebayTok = null;
async function ebayToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayTok && Date.now() < ebayTok.exp) return ebayTok.t;
  const enc = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${enc}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    ebayTok = { t: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
    return d.access_token;
  } catch { return null; }
}
async function ebaySearch(query, limit) {
  const tok = await ebayToken();
  if (!tok || !query) return [];
  const params = new URLSearchParams({ q: query.slice(0, 120), filter: 'conditions:{NEW|LIKE_NEW}', sort: 'price', limit: String(limit), fieldgroups: 'COMPACT' });
  try {
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${tok}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.itemSummaries ?? [])
      .map((it) => ({ title: it.title ?? '', priceJpy: toJpy(parseFloat(it.price?.value), it.price?.currency), img: it.image?.imageUrl ?? it.thumbnailImages?.[0]?.imageUrl ?? '', url: it.itemWebUrl ?? '' }))
      .filter((x) => x.title && x.priceJpy > 0 && x.img && !SET_EXCLUDE.test(x.title));
  } catch { return []; }
}
async function rakutenSearch(keyword) {
  if (!keyword) return [];
  const params = new URLSearchParams({ applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY, affiliateId: RAKUTEN_AFFILIATE_ID, hits: '30', page: '1', sort: '-reviewCount', format: 'json', minPrice: '1000', maxPrice: '100000', keyword });
  try {
    const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`, {
      headers: { Referer: 'https://www.yushutsu-fukugyo.com/', Origin: 'https://www.yushutsu-fukugyo.com' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.Items ?? []).map((x) => x.Item).filter(Boolean).map((it) => ({
      name: it.itemName, price: it.itemPrice,
      img: (it.mediumImageUrls?.[0]?.imageUrl || it.smallImageUrls?.[0]?.imageUrl || '').replace(/_ex=\d+x\d+/, '_ex=600x600'),
      url: it.itemUrl,
    })).filter((r) => r.name && r.img && r.price >= 1000);
  } catch { return []; }
}

async function gemini(prompt, maxTok) {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTok, temperature: 0 } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch { return null; }
}
const toJa = (en) => gemini(`Convert this eBay listing title to a short Japanese Rakuten search keyword (max 4 words, Japanese only, no English): "${en}". Output only the keyword.`, 40);
const toEn = (ja) => gemini(`Convert this Japanese product title into a short English eBay search query (max 6 words) that uniquely identifies the product. Keep model numbers, character names and sizes: "${ja}". Output only the query.`, 40);

async function imgMatch(rImg, eImg, rt, et) {
  if (!rImg || !eImg || !GEMINI_API_KEY) return false;
  try {
    const [a, b] = await Promise.all([fetch(rImg, { signal: AbortSignal.timeout(8000) }), fetch(eImg, { signal: AbortSignal.timeout(8000) })]);
    if (!a.ok || !b.ok) return false;
    const [ab, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    const prompt = `Do these two photos show the EXACT SAME product variant? Image1=Rakuten(Japan) title "${(rt || '').slice(0, 120)}". Image2=eBay title "${(et || '').slice(0, 120)}". Same character/model/card number/grade/edition/volume required; a genuine item != a compatible/aftermarket part; single != set. Answer YES or NO only.`;
    const body = { contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: a.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(ab).toString('base64') } },
      { inlineData: { mimeType: b.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(bb).toString('base64') } },
    ]}], generationConfig: { maxOutputTokens: 4, temperature: 0 } };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return false;
    const d = await res.json();
    return (d?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().toUpperCase().startsWith('YES');
  } catch { return false; }
}

const pair = (strategy, cat, r, e) => ({ strategy, cat, rakutenName: r.name, rakutenImg: r.img, rakutenPrice: r.price, ebayTitle: e.title, ebayImg: e.img, ebayPriceJpy: e.priceJpy, ebayUrl: e.url });

async function stratEbayFirst(g) {
  const out = [];
  const eItems = await ebaySearch(g.ebayQ, PER_GENRE * 2);
  for (const e of eItems.slice(0, PER_GENRE)) {
    const kw = (await toJa(e.title)) || g.rakutenKw;
    const rItems = (await rakutenSearch(kw)).filter((r) => !excluded(r.name));
    for (const r of rItems.slice(0, CANDIDATES)) {
      if (codesConflict(r.name, e.title)) continue;
      if (await imgMatch(r.img, e.img, r.name, e.title)) { out.push(pair('A', g.cat, r, e)); break; }
    }
    await sleep(200);
  }
  return out;
}
async function stratRakutenFirst(g) {
  const out = [];
  const rItems = (await rakutenSearch(g.rakutenKw)).filter((r) => !excluded(r.name));
  for (const r of rItems.slice(0, PER_GENRE)) {
    const kw = (await toEn(r.name)) || g.ebayQ;
    const eItems = await ebaySearch(kw, CANDIDATES + 2);
    for (const e of eItems.slice(0, CANDIDATES)) {
      if (codesConflict(r.name, e.title)) continue;
      if (await imgMatch(r.img, e.img, r.name, e.title)) { out.push(pair('B', g.cat, r, e)); break; }
    }
    await sleep(200);
  }
  return out;
}
async function stratIdentifier(g) {
  const out = [];
  const eItems = await ebaySearch(g.ebayQ, PER_GENRE * 3);
  let used = 0;
  for (const e of eItems) {
    if (used >= PER_GENRE) break;
    const codes = extractCodes(e.title);
    if (!codes.length) continue; // 番号が無いものはこの戦略の対象外
    used++;
    const rItems = (await rakutenSearch(codes[0])).filter((r) => !excluded(r.name));
    for (const r of rItems.slice(0, CANDIDATES)) {
      if (codesConflict(r.name, e.title)) continue; // 番号一致が前提
      if (await imgMatch(r.img, e.img, r.name, e.title)) { out.push(pair('C', g.cat, r, e)); break; }
    }
    await sleep(200);
  }
  return out;
}

(async () => {
  const all = [];
  for (const g of GENRES) {
    for (const [name, strat] of [['A', stratEbayFirst], ['B', stratRakutenFirst], ['C', stratIdentifier]]) {
      try {
        const pairs = await strat(g);
        all.push(...pairs);
        console.error(`done ${name} ${g.cat}: ${pairs.length} pairs`);
      } catch (e) {
        console.error(`err ${name} ${g.cat}: ${e.message}`);
      }
    }
  }
  console.log('EXPERIMENT_RESULTS_START');
  console.log(JSON.stringify(all));
  console.log('EXPERIMENT_RESULTS_END');
})();
