#!/usr/bin/env node
// scripts/refresh.mjs — GitHub Actions バックグラウンド処理
// フロー: eBay日本発送売れ済み → 日本語KW変換 → 楽天検索 → 画像マッチ → 利益計算

// ========== 設定 ==========
const RAKUTEN_APP_ID      = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY  = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const EBAY_APP_ID         = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET  = process.env.EBAY_CLIENT_SECRET;
const GEMINI_API_KEY      = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;
const KV_URL              = process.env.KV_REST_API_URL;
const KV_TOKEN            = process.env.KV_REST_API_TOKEN;

const USD_TO_JPY          = 155;
const GBP_TO_JPY          = 197;
const AUD_TO_JPY          = 100;
const EBAY_FEE_RATE       = 0.1325;
const EBAY_FEE_FIXED_JPY  = 47;
const SHIPPING_COST_JPY   = 0; // 送料は購入者負担

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ========== Haiku レート制限ゲート ==========
// 実際のAPI呼び出し（キャッシュミス時のみ）を最低 HAIKU_MIN_INTERVAL_MS 間隔に直列化し、
// 1分あたりの呼び出しを Tier1 の 50 RPM 以内（≈43回/分）に抑える。キャッシュヒットは通らない。
const HAIKU_MIN_INTERVAL_MS = 1400;
let _haikuQueue = Promise.resolve();
function haikuGate() {
  const wait = _haikuQueue;
  _haikuQueue = wait.then(() => sleep(HAIKU_MIN_INTERVAL_MS));
  return wait;
}

// ========== Upstash KV ==========
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    if (!data.result) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch { return null; }
}

async function kvSet(key, value, exSeconds = 86400) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]]),
    });
  } catch (e) { console.error('kvSet error:', e.message); }
}

async function kvSetPermanent(key, value) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, JSON.stringify(value)]]),
    });
  } catch (e) { console.error('kvSetPermanent error:', e.message); }
}

// ハッシュ全取得（{field: value} で返す）。SOLDライフサイクルの sold_since 読み出しに使う。
async function kvHgetall(key) {
  try {
    const res = await fetch(`${KV_URL}/hgetall/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    const arr = data.result;
    if (!Array.isArray(arr)) return {};
    const obj = {};
    for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
    return obj;
  } catch { return {}; }
}

async function kvDel(key) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['DEL', key]]),
    });
  } catch (e) { console.error('kvDel error:', e.message); }
}

async function kvHdel(key, field) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['HDEL', key, field]]),
    });
  } catch (e) { console.error('kvHdel error:', e.message); }
}

// ========== 除外パターン ==========
const EXCLUDE_PATTERN = /オリパ|ばら売り|パック売り|BOXくじ|ボックスくじ|くじ引き|ガチャ|オリジナルパック|アソート売り|\d+パック\s*(売り|のみ|セット)/i;
const ACCESSORY_EXCLUDE_PATTERN = /クリアケース|カードローダー|ローダー|カードスリーブ|スリーブ\d+枚|デッキケース|カードファイル|バインダー|カードバインダー|BOX保管|保管用|保護ケース|スタンド|ディスプレイケース|展示ケース/i;

// ========== eBayクエリハッシュ ==========
function ebayQueryHash(query) {
  let h = 0;
  for (const c of query) { h = Math.imul(31, h) + c.charCodeAt(0) | 0; }
  return Math.abs(h).toString(36);
}

// ========== 利益計算 ==========
function calcProfit(rakutenPrice, ebayAvgJpy, pointAmount) {
  const effectiveBuy = rakutenPrice - pointAmount;
  if (effectiveBuy <= 0) return { profit: 0, profitRate: 0 };
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuy - ebayFee - SHIPPING_COST_JPY;
  return { profit, profitRate: Math.round((profit / effectiveBuy) * 100) };
}

// ========== カテゴリ推定 ==========
// 注意: 単独の MG/HG/RG/PG は「資生堂MG5」等を誤ってガンプラ判定するため必ず \b で囲む。
// また「クレンズ」が /レンズ/ にマッチしてカメラ誤判定になるため、コスメ・美容を先に判定する。
function guessCategory(title) {
  const t = title || '';
  // コスメ・美容を先に（資生堂MG5・専科クレンズ等の誤判定を防ぐ）
  if (/コスメ|香水|スキンケア|資生堂|花王|ランコム|シャネル|専科|アネッサ|ウーノ|\bUNO\b|イハダ|MG5|エムジー5|化粧水|乳液|美容液|洗顔|クレンジング|日焼け止め|\bSPF|ボディミルク|ハンドクリーム/i.test(t)) return 'コスメ';
  if (/ポケモン|遊戯王|デュエルマスターズ|トレカ|カードゲーム|ワンピースカード|カードバトル/i.test(t)) return 'トレカ';
  if (/ガンプラ|ガンダム|\bMG\b|\bHG\b|\bRG\b|\bPG\b|1\/100|1\/144|BANDAI SPIRITS/i.test(t)) return 'ガンプラ';
  if (/LEGO|レゴ/i.test(t)) return 'LEGO';
  if (/フィギュア|ねんどろいど|Nendoroid|figma|プライズ|グッドスマイル|GOOD SMILE/i.test(t)) return 'フィギュア';
  if (/Nintendo Switch|PS5|PlayStation|Xbox/i.test(t)) return 'ゲーム機';
  if (/amiibo|アミーボ|ゲームソフト/i.test(t)) return 'ゲーム';
  if (/腕時計|Watch|Seiko|セイコー|Citizen|シチズン|Casio|カシオ|Gショック|G-SHOCK/i.test(t)) return '腕時計';
  if (/カメラ|レンズ|Canon|Nikon|Fujifilm|一眼レフ/i.test(t)) return 'カメラ';
  if (/トミカ|プラレール|シルバニア/i.test(t)) return 'おもちゃ';
  return 'その他';
}

// eBayタイトルが「汎用的すぎる」(型番・固有名がほぼ無い)か判定。
// 例: "BANDAI Plastic Model Gunpla MASTER GRADE Preowned" → true（キット名が無い）。
// これが true の商品は coreKeyword を楽天タイトルの英訳に差し替え、検索で同じ商品が出やすくする。
const KW_GENERIC = new Set([
  'bandai', 'spirits', 'plastic', 'model', 'kit', 'gunpla', 'master', 'grade', 'high', 'figure',
  'nintendo', 'japan', 'japanese', 'new', 'sealed', 'unopened', 'preowned', 'used', 'official',
  'authentic', 'genuine', 'import', 'imported', 'limited', 'edition', 'rare', 'set', 'lot', 'toy',
  'collectible', 'collection', 'anime', 'game', 'the', 'and', 'for', 'with',
]);
function isWeakKeyword(title) {
  const toks = (title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  if (toks.some(t => /\d/.test(t))) return false;            // 型番・番号があれば特定できる＝弱くない
  const distinct = toks.filter(t => t.length >= 3 && !KW_GENERIC.has(t));
  return distinct.length < 2;                                // 固有名がほぼ無い＝汎用
}

// カード番号・型番の抽出（ST13-002 / P-028 / DW-5600E / GWG-1000-1A3 等）。年号や容量の裸数字は拾わない。
function extractCodes(s) {
  const up = (s || '').toUpperCase();
  const m = up.match(/\b[A-Z]{1,4}-?\d{1,4}(?:[-/][A-Z0-9]{1,6})*\b/g) || [];
  return [...new Set(
    m.filter(c => /\d/.test(c) && (/[-/]/.test(c) || /[A-Z]{2,}\d/.test(c)))
      .map(c => c.replace(/[^A-Z0-9]/g, ''))
  )];
}
// 2つのタイトルの番号が食い違う＝別商品の誤マッチ（同キャラ別番号カード等）。
// 前方一致は同型のサブ変種(GWG-1000 ⊂ GWG-1000-1A3)として許容。どちらかに番号が無ければ判定しない。
function codesConflict(a, b) {
  const ca = extractCodes(a), cb = extractCodes(b);
  if (!ca.length || !cb.length) return false;
  return !ca.some(x => cb.some(y => x === y || x.startsWith(y) || y.startsWith(x)));
}

// ========== 楽天商品取得 ==========
async function fetchRakutenPage(keyword, page) {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    hits: '30',
    page: String(page),
    sort: '-reviewCount',
    format: 'json',
    minPrice: '1000',
    maxPrice: '100000',
    keyword,
  });
  try {
    const res = await fetch(
      `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`,
      {
        headers: {
          Referer: 'https://www.yushutsu-fukugyo.com/',
          Origin: 'https://www.yushutsu-fukugyo.com',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];
    return (await res.json()).Items ?? [];
  } catch { return []; }
}

// ========== 画像マッチ（Haiku / Geminiフォールバック） ==========
let haikuCallsToday = 0;

async function isImageMatch(rakutenUrl, ebayUrl, rakutenQuantity = null) {
  if (!rakutenUrl || !ebayUrl) return true;

  const cacheKey = `haiku_img:${ebayQueryHash(rakutenUrl + ebayUrl)}`;
  const cached = await kvGet(cacheKey);
  if (cached !== null) return cached === true || cached === 'true';

  // Anthropic APIキーがなければGeminiにフォールバック
  if (!ANTHROPIC_API_KEY) {
    if (!GEMINI_API_KEY) return true;
    try {
      const [r1, r2] = await Promise.all([
        fetch(rakutenUrl, { signal: AbortSignal.timeout(5000) }),
        fetch(ebayUrl, { signal: AbortSignal.timeout(5000) }),
      ]);
      if (!r1.ok || !r2.ok) return true;
      const [b1, b2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
      const body = {
        contents: [{ parts: [
          { text: 'Are these two product images showing the EXACT SAME product type and model? Answer YES or NO only.' },
          { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(b1).toString('base64') } },
          { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(b2).toString('base64') } },
        ]}],
        generationConfig: { maxOutputTokens: 4, temperature: 0 },
      };
      const gr = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }
      );
      if (!gr.ok) return true;
      const gd = await gr.json();
      const answer = gd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() ?? '';
      const result = answer.startsWith('YES');
      await kvSet(cacheKey, result, 168 * 3600);
      return result;
    } catch { return true; }
  }

  try {
    const [r1, r2] = await Promise.all([
      fetch(rakutenUrl, { signal: AbortSignal.timeout(5000) }),
      fetch(ebayUrl, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (!r1.ok || !r2.ok) return true;

    const [b1, b2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);

    const body = {
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Compare these two product images carefully.
Image 1 is from a Japanese online store (Rakuten).${rakutenQuantity ? ` Known quantity: ${rakutenQuantity}.` : ''}
Image 2 is from eBay.

Answer these three questions:
1. Are they the SAME type of product? (e.g. both are watch straps, not strap vs watch)
2. Are they the SAME specific product? (same model, same edition, same version)
3. Does the QUANTITY match? (e.g. single item vs set of 10, 1 pack vs 1 BOX)

Reply in exactly this format:
SAME_TYPE: YES/NO
SAME_PRODUCT: YES/NO
SAME_QUANTITY: YES/NO
REASON: (one short sentence)`
          },
          {
            type: 'image',
            source: { type: 'base64', media_type: r1.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(b1).toString('base64') }
          },
          {
            type: 'image',
            source: { type: 'base64', media_type: r2.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(b2).toString('base64') }
          },
        ]
      }]
    };

    await haikuGate(); // レート制限内に収める（キャッシュミス時のみ到達）
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    haikuCallsToday++;

    if (!res.ok) return true;
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? '';

    const sameType     = /SAME_TYPE:\s*YES/i.test(text);
    const sameProduct  = /SAME_PRODUCT:\s*YES/i.test(text);
    const sameQuantity = /SAME_QUANTITY:\s*YES/i.test(text);
    const result = sameType && sameProduct && sameQuantity;

    if (!result) {
      const reason = text.match(/REASON:\s*(.+)/i)?.[1] ?? '';
      console.log(`  [Haiku NG] ${reason}`);
    }

    await kvSet(cacheKey, result, 168 * 3600);
    return result;
  } catch { return true; }
}

// ========== eBay OAuth トークン（Browse API用） ==========
let ebayTokenCache = null;
async function getEbayToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayTokenCache && Date.now() < ebayTokenCache.expiresAt) return ebayTokenCache.token;
  const encoded = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.error(`  [OAuth] HTTP ${res.status}`); return null; }
    const data = await res.json();
    ebayTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch (e) { console.error(`  [OAuth] ${e.message}`); return null; }
}

// ========== Phase 0: eBay Browse API で日本出品の現行商品を取得 ==========
// Browse APIはOAuth認証必須のため503ブロックを回避できる
// soldItemsOnlyはBrowse APIでは非対応のため「現在出品中・日本発送」を取得
const EBAY_JP_QUERIES = [
  { q: 'pokemon card booster box japanese sealed',  name: 'ポケモンカード' },
  { q: 'yu-gi-oh card booster box japanese sealed',  name: '遊戯王' },
  { q: 'one piece card game booster box japanese',   name: 'ワンピースカード' },
  { q: 'gunpla model kit bandai master grade',       name: 'ガンプラMG' },
  { q: 'gunpla high grade bandai japan new',         name: 'ガンプラHG' },
  { q: 'nendoroid figure good smile new sealed',     name: 'ねんどろいど' },
  { q: 'lego set japan new sealed',                  name: 'LEGO' },
  { q: 'seiko watch new japan',                      name: 'セイコー' },
  { q: 'casio g-shock new japan',                    name: 'Gショック' },
  { q: 'shiseido skincare japan new',                name: '資生堂' },
  { q: 'tomica diecast car japan new',               name: 'トミカ' },
  { q: 'amiibo nintendo new japan sealed',           name: 'アミーボ' },
];

async function fetchEbayJapanSoldItems() {
  const cacheKey = 'ebay_jp_sold_titles';
  const cached = await kvGet(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    console.log(`  [Phase0 cache] ${cached.length}件`);
    return cached;
  }

  const token = await getEbayToken();
  if (!token) {
    console.error('  [Phase0] OAuthトークン取得失敗');
    return [];
  }

  const allItems = [];
  for (const { q, name } of EBAY_JP_QUERIES) {
    const params = new URLSearchParams({
      q,
      filter: 'itemLocationCountry:JP,conditions:{NEW|LIKE_NEW}',
      sort: 'price',
      limit: '100',
      fieldgroups: 'COMPACT',
    });
    try {
      const res = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!res.ok) { console.log(`  [Phase0] ${name} → HTTP ${res.status}`); continue; }
      const data = await res.json();
      const items = data?.itemSummaries ?? [];
      for (const item of items) {
        const title = item?.title ?? '';
        const price = parseFloat(item?.price?.value);
        const currency = item?.price?.currency;
        if (!title || isNaN(price) || price <= 0) continue;
        let priceJpy = 0;
        if (currency === 'USD') priceJpy = Math.round(price * USD_TO_JPY);
        else if (currency === 'GBP') priceJpy = Math.round(price * GBP_TO_JPY);
        else if (currency === 'AUD') priceJpy = Math.round(price * AUD_TO_JPY);
        else if (currency === 'JPY') priceJpy = Math.round(price);
        if (priceJpy < 1000) continue;
        const imageUrl = item?.image?.imageUrl ?? item?.thumbnailImages?.[0]?.imageUrl ?? '';
        const itemUrl  = item?.itemWebUrl ?? '';
        allItems.push({ title, priceJpy, category: name, imageUrl, itemUrl });
      }
      console.log(`  [Phase0] ${name} → ${items.length}件`);
      await sleep(300);
    } catch (e) {
      console.error(`  [Phase0 ERROR] ${name}: ${e.message}`);
    }
  }

  const unique = [...new Map(allItems.map(i => [i.title, i])).values()];
  await kvSet(cacheKey, unique, 6 * 3600);
  console.log(`  [Phase0] 合計 ${unique.length}件取得`);
  return unique;
}

// eBayタイトル → 楽天日本語キーワード変換（Haiku、KVキャッシュ168h）
async function ebayTitleToRakutenKeyword(ebayTitle) {
  if (!ANTHROPIC_API_KEY) return null;
  const cacheKey = `rakuten_kw:${ebayQueryHash(ebayTitle)}`;
  const cached = await kvGet(cacheKey);
  if (cached) return cached;

  try {
    await haikuGate(); // レート制限内に収める（キャッシュミス時のみ到達）
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 60,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Convert this eBay listing title to a short Japanese Rakuten search keyword (max 4 words, Japanese only, no English).
eBay title: "${ebayTitle}"
Output the Japanese keyword only, nothing else.`
        }]
      }),
      signal: AbortSignal.timeout(10000),
    });
    haikuCallsToday++;
    if (!res.ok) return null;
    const data = await res.json();
    const kw = data?.content?.[0]?.text?.trim() ?? '';
    if (!kw || kw.length < 2) return null;
    await kvSet(cacheKey, kw, 168 * 3600);
    return kw;
  } catch { return null; }
}

// 楽天の日本語タイトル → eBay検索用の英語キーワード（汎用的すぎるeBayタイトルの置換用）。
// 型番・キット名・キャラ名・容量を残し、状態/発送語は省く。Haiku・168hキャッシュ。
async function rakutenTitleToEnglishKeyword(jpTitle) {
  if (!ANTHROPIC_API_KEY) return null;
  const cacheKey = `en_kw:${ebayQueryHash(jpTitle)}`;
  const cached = await kvGet(cacheKey);
  if (cached) return cached;
  try {
    await haikuGate();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 40,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Convert this Japanese product title into a short English eBay search query (max 6 words) that uniquely identifies the product. Keep model numbers, kit names, character names and sizes; drop condition/shipping/seller words.
Japanese: "${jpTitle}"
Output only the English query, nothing else.`,
        }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    haikuCallsToday++;
    if (!res.ok) return null;
    const data = await res.json();
    const kw = data?.content?.[0]?.text?.trim() ?? '';
    if (!kw || kw.length < 3) return null;
    await kvSet(cacheKey, kw, 168 * 3600);
    return kw;
  } catch { return null; }
}

// ========== 相場(単品中央値)の取得 ==========
// coreKeyword から識別子(型番/カード番号)を残した検索語を作る（toEbayMarketUrl と同方針）。
const PRICE_NOISE = /\b(new|sealed|unopened|opened|mint|nib|misb|bnib|preowned|pre-owned|used|official|authentic|genuine|japan|japanese|jp|import|imported|version|ver|limited|edition|exclusive|free|shipping|fast|tracking|rare|htf|lot|with|for|from|the|and|of|in|brand|preorder|pre-order)\b/gi;
function searchQueryFor(coreKeyword) {
  const ts = (coreKeyword || '')
    .replace(/【[^】]*】/g, ' ').replace(/[^\x00-\x7F]/g, ' ').replace(/[^A-Za-z0-9#.\/\s-]/g, ' ')
    .replace(PRICE_NOISE, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const isId = t => /\d/.test(t) || /[A-Za-z].*-.*[A-Za-z0-9]/.test(t);
  const ids = ts.filter(isId).slice(0, 2);
  const names = ts.filter(t => !isId(t)).slice(0, 4);
  const picked = [...names, ...ids];
  return (picked.length ? picked : ts.slice(0, 6)).join(' ');
}

// セット/まとめ売り(複数個)の除外。中央値を「単品」に寄せる。
const PRICE_SET_RE = /\b(lot of \d|set of \d|\d+\s*pcs|\d+\s*pieces|bundle|\d+\s*x\b|x\s*\d+|\d+\s*-?\s*pack|joblot|job lot|wholesale|\d+\s*set\b)\b/i;
function trimmedMedianJpy(pricesJpy) {
  const xs = pricesJpy.filter(p => p > 0).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const m0 = xs[Math.floor(xs.length / 2)];
  const kept = xs.filter(p => p >= m0 * 0.4 && p <= m0 * 2.5); // 外れ値(付属品/極端値)をトリム
  const use = kept.length >= 3 ? kept : xs;
  return { median: use[Math.floor(use.length / 2)], count: use.length };
}

// eBay現在出品の「単品中央値(JPY)」。セット除外＋外れ値トリム。24hキャッシュ。失敗/少数時はnull。
async function ebayMedianSinglePriceJpy(query) {
  if (!query) return null;
  const cacheKey = `median_jpy:${ebayQueryHash(query)}`;
  const cached = await kvGet(cacheKey);
  if (cached && typeof cached === 'object' && cached.median > 0) return cached;
  const token = await getEbayToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({ q: query, limit: '24', fieldgroups: 'COMPACT' });
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const prices = (data?.itemSummaries ?? [])
      .filter(it => !PRICE_SET_RE.test(it?.title ?? ''))
      .map(it => {
        const v = parseFloat(it?.price?.value); const c = it?.price?.currency;
        if (!v || v <= 0) return 0;
        if (c === 'USD') return Math.round(v * USD_TO_JPY);
        if (c === 'GBP') return Math.round(v * GBP_TO_JPY);
        if (c === 'AUD') return Math.round(v * AUD_TO_JPY);
        if (c === 'JPY') return Math.round(v);
        return 0;
      })
      .filter(p => p > 0);
    const result = trimmedMedianJpy(prices);
    if (result) await kvSet(cacheKey, result, 24 * 3600);
    return result;
  } catch { return null; }
}

// ========== メイン処理 ==========
async function main() {
  console.log(`\n🚀 refresh.mjs 開始 ${new Date().toISOString()}`);
  const startedAt = Date.now();

  // Phase 0: eBay日本発送売れ済み商品を取得（6時間キャッシュ）
  console.log('\n🌐 Phase 0: eBay日本発送売れ済み商品を取得...');
  const ebayJpItems = await fetchEbayJapanSoldItems();
  console.log(`  取得: ${ebayJpItems.length}件`);

  if (ebayJpItems.length === 0) {
    console.log('  ⚠️ eBay売れ筋商品が取得できませんでした。終了します。');
    return;
  }

  // 既存DB・チェック済みIDをロード
  const CHECKED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90日
  const now = Date.now();
  // KVが想定外の非配列値（破損・切り詰めJSON等）を返しても run 全体が落ちないようガード
  const rawChecked = await kvGet('checked_ids');
  const validChecked = (Array.isArray(rawChecked) ? rawChecked : [])
    .map(e => typeof e === 'string' ? { id: e, checkedAt: 0 } : e)
    .filter(e => now - e.checkedAt < CHECKED_TTL_MS);
  const checkedIds = new Set(validChecked.map(e => e.id));
  const allCheckedMap = new Map(validChecked.map(e => [e.id, e]));

  const rawProducts = await kvGet('profitable_products');
  const loadedProducts = (Array.isArray(rawProducts) ? rawProducts : []).map(p => {
    // 旧データの ebaySoldUrl が現行出品URLになっている場合は売れ済み検索URLに修正
    if (p.ebaySoldUrl && !p.ebaySoldUrl.includes('LH_Sold=1') && p.coreKeyword) {
      p.ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(p.coreKeyword)}&LH_Complete=1&LH_Sold=1`;
    }
    // addedAt 未設定の旧データは固定の過去時刻で補完（既存の並び順を保ったまま新着の下に来る）
    if (!p.addedAt) p.addedAt = '2020-01-01T00:00:00.000Z';
    return p;
  });
  // id重複を毎回自動で排除（過去のバグ由来の残存重複を定期クリーンアップ）。最初の出現を優先。
  const seenIds = new Set(); // 楽天itemCode
  let dedupedProducts = loadedProducts.filter(p => {
    if (!p.id || seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });
  const dupRemoved = loadedProducts.length - dedupedProducts.length;
  if (dupRemoved > 0) console.log(`  🧹 重複DB自動クリーンアップ: ${dupRemoved}件除去`);

  // ── SOLDライフサイクル: SOLD化(出品者10超)から30日経った商品はDBから削除し、再検知に回す ──
  // 同時に出品者カウント(listing_actors)をリセットし、eBayハッシュをchecked_idsから外して
  // 再処理対象に戻す。→ 再び新しい利益商品として検知・掲載される。
  const SOLD_HOLD_MS = 30 * 24 * 60 * 60 * 1000;
  const soldSince = await kvHgetall('sold_since');
  const agedOut = new Set(
    Object.entries(soldSince)
      .filter(([, since]) => now - Number(since) > SOLD_HOLD_MS)
      .map(([id]) => id)
  );
  if (agedOut.size > 0) {
    for (const p of dedupedProducts) {
      if (agedOut.has(p.id) && p.coreKeyword) {
        const h = String(ebayQueryHash(p.coreKeyword));
        allCheckedMap.delete(h); // 保存される checked_ids から外す
        checkedIds.delete(h);    // 今回の処理対象に戻す
      }
    }
    for (const id of agedOut) {
      await kvDel(`listing_actors:${id}`); // 出品者カウントをリセット
      await kvHdel('sold_since', id);
    }
    dedupedProducts = dedupedProducts.filter(p => !agedOut.has(p.id));
    console.log(`  ♻️ SOLD 30日経過: ${agedOut.size}件をDBから削除→再検知へ`);
  }

  // 既存商品にも最新ロジックを遡及適用：カテゴリを再判定（誤分類の修正）し、
  // coreKeyword が汎用的すぎる場合は楽天タイトルの英訳に差し替える（相場検索の精度向上）。
  // guessCategory は純関数で安全、英訳は en_kw キャッシュ済みのため負荷は小さい。
  let recat = 0, rekw = 0;
  for (const p of dedupedProducts) {
    if (p.title) {
      const c = guessCategory(p.title);
      if (c !== p.category) { p.category = c; recat++; }
    }
    if (p.coreKeyword && p.title && isWeakKeyword(p.coreKeyword)) {
      const en = await rakutenTitleToEnglishKeyword(p.title);
      if (en && en !== p.coreKeyword) {
        p.coreKeyword = en;
        p.ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(en)}&LH_Complete=1&LH_Sold=1`;
        rekw++;
      }
    }
  }
  if (recat || rekw) console.log(`  🔧 既存データ補正: カテゴリ再判定 ${recat}件 / coreKeyword英訳 ${rekw}件`);

  // 既存の誤マッチ（カード番号/型番が楽天タイトルと食い違う＝別商品）を除外。
  {
    const before = dedupedProducts.length;
    dedupedProducts = dedupedProducts.filter(p => !(p.title && p.coreKeyword && codesConflict(p.title, p.coreKeyword)));
    const dropped = before - dedupedProducts.length;
    if (dropped) console.log(`  🧹 番号不一致の誤マッチを除外: ${dropped}件`);
  }

  // 既存商品の相場を eBay単品中央値で再評価し、過大な利益表示を是正（保守的に小さい方を採用）。
  // 中央値は24hキャッシュ。安全装置：万一>40%で利益消失するなら中央値の異常を疑い適用を見送る。
  const repriced = [];
  for (const p of dedupedProducts) {
    if (!p.coreKeyword || !p.source || !(p.realAvgPrice > 0)) continue;
    const med = await ebayMedianSinglePriceJpy(searchQueryFor(p.coreKeyword));
    if (!med || med.count < 5) continue;
    if (med.median >= p.realAvgPrice) { p.realCount = med.count; continue; } // 下がらないなら件数だけ反映
    const r = calcProfit(p.source.price, med.median, p.source.pointAmount ?? 0);
    repriced.push({ p, newAvg: med.median, count: med.count, profit: r.profit, rate: r.profitRate });
  }
  const wouldDrop = repriced.filter(x => x.profit < 1).length;
  if (repriced.length && wouldDrop / dedupedProducts.length > 0.4) {
    console.log(`  ⚠️ 中央値再評価で${wouldDrop}/${dedupedProducts.length}件が利益消失(>40%)。異常の可能性があるため再評価を見送り。`);
  } else if (repriced.length) {
    const drop = new Set();
    let updated = 0;
    for (const x of repriced) {
      x.p.realAvgPrice = x.newAvg; x.p.realCount = x.count; x.p.realProfit = x.profit; x.p.realProfitRate = x.rate;
      if (x.profit < 1) drop.add(x.p.id); else updated++;
    }
    dedupedProducts = dedupedProducts.filter(p => !drop.has(p.id));
    console.log(`  💹 相場を単品中央値で是正: ${updated}件更新 / ${drop.size}件は利益消失で除外`);
  }

  const existingIds = new Set(dedupedProducts.map(p => p.id)); // 楽天itemCode
  const existingProducts = dedupedProducts;
  const profitableProducts = [...existingProducts];

  console.log(`  既存DB: ${existingProducts.length}件 / チェック済み: ${checkedIds.size}件`);

  // 未処理のeBayアイテムに絞り込み（eBayタイトルハッシュをIDとして管理）
  const MAX_PROCESS = 400;
  const CONCURRENCY = 5;

  const toProcess = ebayJpItems.filter(item => {
    const id = String(ebayQueryHash(item.title));
    return !checkedIds.has(id);
  }).slice(0, MAX_PROCESS);

  console.log(`\n🔍 Phase 1→2: ${toProcess.length}件を処理 (並列${CONCURRENCY}件)...`);

  // 1件のeBay商品を処理: キーワード変換 → 楽天検索 → 画像マッチ → 利益計算
  async function processEbayItem(ebayItem) {
    const itemId = String(ebayQueryHash(ebayItem.title));

    // Haiku: eBayタイトル → 日本語楽天キーワード
    const jpKeyword = await ebayTitleToRakutenKeyword(ebayItem.title);
    if (!jpKeyword) return { type: 'skip', id: itemId };

    // 楽天で検索（2ページ）
    const rakutenItems = [];
    for (const page of [1, 2]) {
      const items = await fetchRakutenPage(jpKeyword, page);
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000) continue;
        if (EXCLUDE_PATTERN.test(it.itemName)) continue;
        if (ACCESSORY_EXCLUDE_PATTERN.test(it.itemName)) continue;
        if (existingIds.has(it.itemCode)) continue;
        rakutenItems.push(it);
      }
      await sleep(1100);
    }

    if (rakutenItems.length === 0) return { type: 'skip', id: itemId };

    const ebayImg = ebayItem.imageUrl ?? '';

    // 楽天上位5件: 先に利益計算（算術のみ・Haiku不要）→ 利益が出る候補だけ画像マッチ（Haiku）。
    // eBay価格は確定済みなので利益判定にHaikuは不要。これで無駄な画像マッチ呼び出しを大幅削減。
    for (const rakutenItem of rakutenItems.slice(0, 5)) {
      const rakutenImg = rakutenItem.mediumImageUrls?.[0]?.imageUrl
        || rakutenItem.smallImageUrls?.[0]?.imageUrl || '';
      if (!rakutenImg) continue; // 画像なしは商品表示にも使えないのでスキップ

      // ① 利益計算（Haiku不要）。利益が出ないものはここでスキップ＝Haiku節約
      // ポイントは楽天APIの実際の倍率を使う（base 1倍=1%）。1箇所で算出し表示・利益計算で共有。
      const pointRate = rakutenItem.pointRate ?? 1;
      const pointAmount = Math.floor(rakutenItem.itemPrice * pointRate / 100);
      const { profit, profitRate } = calcProfit(rakutenItem.itemPrice, ebayItem.priceJpy, pointAmount);
      if (profit < 1 || profitRate > 300) continue;

      // カード番号/型番が食い違う候補は別商品なので除外（同キャラ別番号カード等の誤マッチ防止）。
      // 画像マッチ前に弾くことで Haiku も節約できる。
      if (codesConflict(rakutenItem.itemName, ebayItem.title)) continue;

      // ② 利益が出る候補だけ画像マッチ（Haiku）で同一商品か検証
      if (ebayImg) {
        const matched = await isImageMatch(rakutenImg, ebayImg, null);
        if (!matched) continue;
      }

      console.log(`  💰 ${profitRate}% | 楽天¥${rakutenItem.itemPrice.toLocaleString()} → eBay¥${ebayItem.priceJpy.toLocaleString()} | ${rakutenItem.itemName.slice(0, 35)}`);

      // coreKeyword: 原則 eBayタイトル。汎用的すぎる(キット名/固有名なし)場合のみ、
      // 楽天タイトルを英訳して差し替える。画像一致済みなので価格は妥当、検索語だけ改善する。
      let coreKeyword = ebayItem.title;
      if (isWeakKeyword(ebayItem.title)) {
        const en = await rakutenTitleToEnglishKeyword(rakutenItem.itemName);
        if (en) coreKeyword = en;
      }

      // 相場の妥当性向上：eBay現在出品の「単品中央値」を取り、保守的に小さい方を採用する
      // （1件の高値出品で利益が過大に出るのを防ぐ）。中央値で利益が消えたら出品しない。
      let realAvgPrice = ebayItem.priceJpy, realCount = 1, finalProfit = profit, finalRate = profitRate;
      const med = await ebayMedianSinglePriceJpy(searchQueryFor(coreKeyword));
      if (med && med.count >= 5) {
        realAvgPrice = Math.min(ebayItem.priceJpy, med.median);
        realCount = med.count;
        const r = calcProfit(rakutenItem.itemPrice, realAvgPrice, pointAmount);
        finalProfit = r.profit; finalRate = r.profitRate;
        if (finalProfit < 1 || finalRate > 300) continue;
      }

      return {
        type: 'profit',
        id: itemId,
        rakutenId: rakutenItem.itemCode,
        product: {
          id: rakutenItem.itemCode,
          title: rakutenItem.itemName,
          imageUrl: rakutenImg,
          category: guessCategory(rakutenItem.itemName),
          source: {
            site: 'rakuten',
            siteName: '楽天',
            price: rakutenItem.itemPrice,
            url: rakutenItem.affiliateUrl || rakutenItem.itemUrl,
            pointRate,
            pointAmount,
          },
          isNew: rakutenItem.itemName.includes('新品') || rakutenItem.itemName.includes('未開封'),
          market: 'EBAY_US',
          coreKeyword,
          ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(coreKeyword)}&LH_Complete=1&LH_Sold=1`,
          realAvgPrice,
          realProfit: finalProfit,
          realProfitRate: finalRate,
          realCount,
          avgDaysToSell: null, // eBay Finding API(落札データ)が廃止のため現状取得不可。Marketplace Insights API(要承認)が必要
          addedAt: new Date().toISOString(), // 登録順ソート用（初回登録時刻、以降不変）
        },
      };
    }

    return { type: 'skip', id: itemId };
  }

  // チャンク単位で並列処理
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const chunk = toProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(item =>
      processEbayItem(item).catch(e => {
        console.error(`  [ERROR] ${item.title.slice(0, 30)}: ${e.message}`);
        return { type: 'skip', id: String(ebayQueryHash(item.title)) };
      })
    ));

    for (const res of results) {
      allCheckedMap.set(res.id, { id: res.id, checkedAt: Date.now() });
      // 同一チャンク内で別のeBayタイトルが同じ楽天itemCodeに当たると、並列のexistingIds.hasが
      // 両方すり抜ける。逐次ループ側で live check して重複pushを防ぐ。
      if (res.type === 'profit' && !existingIds.has(res.rakutenId)) {
        existingIds.add(res.rakutenId);
        profitableProducts.push(res.product);
        // 登録順（新着が先頭）で保存。利益率ソートは将来の有料機能としてフロント側で実装
        const sorted = [...profitableProducts].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
        await kvSet('profitable_products', sorted, 480 * 3600);
        await kvSet('last_updated', new Date().toISOString(), 480 * 3600);
      }
    }

    await kvSetPermanent('checked_ids', Array.from(allCheckedMap.values()));

    if (i % 50 === 0 || i + CONCURRENCY >= toProcess.length) {
      console.log(`  進捗: ${Math.min(i + CONCURRENCY, toProcess.length)}/${toProcess.length}件（利益商品: ${profitableProducts.length - existingProducts.length}件）`);
    }
  }

  // 最終保存（登録順・新着が先頭。利益率ソートは将来の有料機能）
  profitableProducts.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  await kvSet('profitable_products', profitableProducts, 480 * 3600);
  await kvSet('last_updated', new Date().toISOString(), 480 * 3600);
  await kvSetPermanent('checked_ids', Array.from(allCheckedMap.values()));
  await kvSet('refresh_stats', {
    ebayJpCount: ebayJpItems.length,
    processedCount: toProcess.length,
    existingCount: existingProducts.length,
    newCount: profitableProducts.length - existingProducts.length,
    profitableCount: profitableProducts.length,
    haikuCalls: haikuCallsToday,
    elapsedMin: Math.round((Date.now() - startedAt) / 60000),
    runAt: new Date().toISOString(),
  }, 480 * 3600);

  console.log(`
✨ 完了!
  eBay売れ済み: ${ebayJpItems.length}件
  処理: ${toProcess.length}件
  新規利益商品: ${profitableProducts.length - existingProducts.length}件
  DB合計: ${profitableProducts.length}件（480時間TTL）
  Claude Haiku: ${haikuCallsToday}回
  所要時間: ${Math.round((Date.now() - startedAt) / 60000)}分
`);
}

main().catch(e => { console.error(e); process.exit(1); });
