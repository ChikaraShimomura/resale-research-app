#!/usr/bin/env node
// scripts/refresh.mjs
// GitHub Actions で実行するバックグラウンド処理
// 時間制限なし・eBayキャッシュで無駄なAPI呼び出しを排除

// ========== 設定 ==========
const RAKUTEN_APP_ID     = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const EBAY_APP_ID        = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const KV_URL             = process.env.KV_REST_API_URL;
const KV_TOKEN           = process.env.KV_REST_API_TOKEN;

const USD_TO_JPY         = 155;
const EBAY_FEE_RATE      = 0.1325;
const EBAY_FEE_FIXED_JPY = 47;
const SHIPPING_COST_JPY  = 2500;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ========== Upstash KV (REST API直接呼び出し) ==========
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
    // pipeline形式でSET + EX
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]]),
    });
  } catch (e) { console.error('kvSet error:', e.message); }
}

// ========== 検索キーワード（eBayで売れる商品に特化・80キーワード） ==========
const SEARCH_KEYWORDS = [
  // ポケモンカード（正規BOX）
  "ポケモンカード BOX 未開封 新品", "ポケモンカード 拡張パック BOX シュリンク",
  "ポケモンカード スカーレット バイオレット BOX 新品",
  "ポケモンカード ハイクラスパック BOX 未開封",
  "ポケモンカード 151 BOX 未開封", "ポケモンカード VSTARユニバース BOX",
  // 遊戯王（正規BOX）
  "遊戯王 BOX 未開封 新品", "遊戯王 パック BOX シュリンク",
  "遊戯王 QUARTER CENTURY BOX", "遊戯王 LINK VRAINS BOX",
  // ワンピースカード
  "ワンピースカード BOX 未開封 新品", "ONE PIECE カード BOX シュリンク",
  // デュエルマスターズ
  "デュエルマスターズ BOX 未開封 新品", "デュエマ BOX シュリンク",
  // ガンプラ MG
  "ガンプラ MG 1/100 新品 未開封", "BANDAI SPIRITS MG ガンダム",
  "バンダイ MG 新品 限定", "MGEX ガンプラ 新品",
  // ガンプラ RG/PG/HG
  "ガンプラ RG 新品 未開封", "ガンプラ PG 1/60 新品",
  "ガンプラ HG 新品 限定", "ガンプラ RE/100 新品",
  // LEGO
  "LEGO テクニック 新品", "LEGO スターウォーズ 新品 未開封",
  "LEGO マインクラフト 新品", "LEGO ハリーポッター 新品",
  "LEGO シティ 新品 未開封", "LEGO クリエイター 新品",
  "LEGO アイデア 新品", "LEGO ニンジャゴー 新品",
  "LEGO アベンジャーズ 新品", "LEGO フラワー 新品",
  // ねんどろいど
  "ねんどろいど 新品 未開封 グッドスマイル",
  "Nendoroid 新品 限定", "ねんどろいど 限定版 新品",
  // figma
  "figma 新品 未開封", "figma 限定 新品",
  // フィギュア各社
  "コトブキヤ フィギュア 新品 未開封",
  "グッドスマイル フィギュア 新品 限定",
  "アルター フィギュア 新品 未開封",
  "メガハウス フィギュア 新品", "FREEing フィギュア 新品",
  "プライズフィギュア 新品 未開封 一番くじ",
  // 腕時計
  "セイコー 腕時計 新品 未使用", "シチズン 腕時計 新品 未使用",
  "カシオ Gショック 新品 未使用", "オリエント 腕時計 新品",
  "セイコー プロスペックス 新品", "セイコー アストロン 新品",
  "セイコー プレサージュ 新品", "シチズン アテッサ 新品",
  // カメラ・レンズ
  "キヤノン レンズ 新品 未使用", "ニコン レンズ 新品 未使用",
  "ソニー Eマウント レンズ 新品", "フジフイルム Xマウント レンズ 新品",
  "OMシステム レンズ 新品",
  // コスメ・スキンケア
  "資生堂 アネッサ 日焼け止め 新品",
  "資生堂 クレ・ド・ポー 新品", "SK-II 新品 正規品",
  "ランコム 新品 正規品", "シュウ ウエムラ 新品",
  // おもちゃ・ホビー
  "トミカ プレミアム 新品 未開封",
  "プラレール 新品 限定", "タカラトミー 限定 新品 未開封",
  "シルバニアファミリー 新品 未開封 限定",
  // アニメグッズ・フィギュア
  "鬼滅の刃 フィギュア 新品 未開封",
  "呪術廻戦 フィギュア 新品 未開封",
  "ワンピース フィギュア 新品 未開封",
  "ドラゴンボール フィギュア 新品 未開封",
  "進撃の巨人 フィギュア 新品 未開封",
  "エヴァンゲリオン フィギュア 新品 未開封",
  "初音ミク フィギュア 新品 未開封",
  "鬼滅の刃 グッズ 新品 限定",
  // ゲーム
  "任天堂 amiibo 新品 未開封",
  "Nintendo Switch ソフト 新品 未開封",
  "PS5 ソフト 新品 未開封",
  // ポケモングッズ
  "ポケモン ぬいぐるみ 新品 公式",
  "ポケモンセンター 限定 新品",
  // 香水
  "シャネル 香水 新品 正規品", "ディオール 香水 新品 正規品",
  "ジョーマローン 新品 正規品",
];

// ========== 除外パターン（オリパ・パック売り等） ==========
const EXCLUDE_PATTERN = /オリパ|ばら売り|パック売り|BOXくじ|ボックスくじ|くじ引き|ガチャ|オリジナルパック|アソート売り|\d+パック\s*(売り|のみ|セット)/i;

// ========== ブランド辞書 ==========
const BRAND_JP_TO_EN = {
  "任天堂": "Nintendo", "ニンテンドー": "Nintendo",
  "ソニー": "Sony", "プレイステーション": "PlayStation",
  "セガ": "Sega", "カプコン": "Capcom", "コナミ": "Konami",
  "バンダイ": "Bandai", "バンダイナムコ": "Bandai Namco",
  "スクウェアエニックス": "Square Enix",
  "レゴ": "LEGO", "タカラトミー": "Takara Tomy", "トミカ": "Tomica",
  "コトブキヤ": "Kotobukiya", "グッドスマイル": "Good Smile Company",
  "マックスファクトリー": "Max Factory", "アルター": "Alter",
  "メガハウス": "MegaHouse", "フリーイング": "FREEing",
  "ポケモン": "Pokemon", "ポケットモンスター": "Pokemon",
  "遊戯王": "Yu-Gi-Oh", "デュエルマスターズ": "Duel Masters",
  "ドラゴンボール": "Dragon Ball", "ナルト": "Naruto",
  "進撃の巨人": "Attack on Titan", "鬼滅の刃": "Demon Slayer",
  "呪術廻戦": "Jujutsu Kaisen", "エヴァンゲリオン": "Evangelion",
  "ガンダム": "Gundam", "ゴジラ": "Godzilla",
  "キヤノン": "Canon", "ニコン": "Nikon",
  "フジフイルム": "Fujifilm", "オリンパス": "Olympus", "パナソニック": "Panasonic",
  "資生堂": "Shiseido", "花王": "Kao", "ランコム": "Lancome",
  "セイコー": "Seiko", "シチズン": "Citizen", "カシオ": "Casio",
  "初音ミク": "Hatsune Miku", "ねんどろいど": "Nendoroid",
  "ワンピース": "One Piece", "シャネル": "Chanel", "ディオール": "Dior",
};

// ========== タイトル → 英語クエリ変換 ==========
function toEnglishQuery(jpTitle) {
  let result = jpTitle;
  for (const [jp, en] of Object.entries(BRAND_JP_TO_EN)) {
    result = result.replace(new RegExp(jp, 'g'), en);
  }
  result = result
    .replace(/今だけ[^\s]*/g, '')
    .replace(/\d+[%％]OFF[^\s]*/g, '')
    .replace(/\d+月\d+日(発売|終了|まで)?/g, '')
    .replace(/送料無料/g, '')
    .replace(/[぀-ゟ゠-ヿ一-鿿＀-￯]/g, ' ')
    .replace(/[^\w\s\-\.\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return result.split(' ').filter(Boolean).slice(0, 6).join(' ');
}

// ========== テキストマッチスコア（①④） ==========
function combinedMatchScore(queryWords, queryLower, ebayTitle) {
  const ebayLower = ebayTitle.toLowerCase();
  // ①前方: クエリ語 → eBayタイトル
  const forward = queryWords.length === 0 ? 0 :
    queryWords.filter(w => w.length >= 2 && ebayLower.includes(w.toLowerCase())).length / queryWords.length;
  // ④逆方向: eBayタイトル語 → クエリ
  const noiseWords = new Set(['new','the','for','and','with','set','box','lot','sealed','pack','bag','case','japan','japanese']);
  const ebayWords = ebayTitle.split(/\s+/)
    .filter(w => /^[A-Za-z]{3,}$/.test(w) || /[A-Za-z]\d|\d[A-Za-z]/.test(w) || /^\d{3,}$/.test(w))
    .map(w => w.toLowerCase())
    .filter(w => !noiseWords.has(w));
  const reverse = ebayWords.length === 0 ? 0 :
    ebayWords.filter(w => queryLower.includes(w)).length / ebayWords.length;
  // 構造トークン（型番・スケール）完全一致ボーナス
  const scaleMatch = (queryLower.match(/\d+\/\d+/g) ?? []).some(s => ebayLower.includes(s));
  if (scaleMatch) return 1.0;
  return forward * 0.6 + reverse * 0.4;
}

// ========== eBay OAuthトークン（メモリキャッシュ） ==========
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
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    ebayTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch { return null; }
}

// ========== eBayキャッシュキー生成 ==========
function ebayQueryHash(query) {
  let h = 0;
  for (const c of query) { h = Math.imul(31, h) + c.charCodeAt(0) | 0; }
  return Math.abs(h).toString(36);
}

// ========== eBay Browse API: ①④テキストマッチ済み候補（キャッシュ付き） ==========
let ebayApiCallsToday = 0;
const EBAY_DAILY_LIMIT = 4800; // 5000のうち200は余裕として確保

async function fetchEbayCandidates(enQuery) {
  if (!enQuery || enQuery.length < 3) return [];
  const queryWords = enQuery.split(/\s+/).filter(w => w.length >= 2);
  const meaningfulWords = queryWords.filter(w => /[A-Za-z0-9]{2,}/.test(w));
  if (meaningfulWords.length === 0) return [];

  // KVキャッシュを確認（22時間有効）
  const cacheKey = `ebay_cache:${ebayQueryHash(enQuery)}`;
  const cached = await kvGet(cacheKey);
  if (cached && Array.isArray(cached)) {
    console.log(`  [cache hit] ${enQuery.slice(0, 40)}`);
    return cached;
  }

  // APIレート制限チェック
  if (ebayApiCallsToday >= EBAY_DAILY_LIMIT) {
    console.log('  [eBay] Daily limit reached, using cache only');
    return [];
  }

  const token = await getEbayToken();
  if (!token) return [];

  const queryLower = enQuery.toLowerCase();
  const params = new URLSearchParams({
    q: enQuery,
    filter: 'buyingOptions:{FIXED_PRICE},conditions:{NEW|LIKE_NEW}',
    sort: 'bestMatch',
    limit: '20',
    fieldgroups: 'COMPACT',
  });

  try {
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
        signal: AbortSignal.timeout(8000),
      }
    );
    ebayApiCallsToday++;
    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.itemSummaries ?? [];
    const candidates = [];

    for (const item of items) {
      const score = combinedMatchScore(queryWords, queryLower, item?.title ?? '');
      if (score < 0.5) continue;
      const price = parseFloat(item?.price?.value);
      const currency = item?.price?.currency;
      if (isNaN(price) || price <= 0) continue;
      const priceJpy = currency === 'USD' ? Math.round(price * USD_TO_JPY)
                     : currency === 'JPY' ? Math.round(price) : 0;
      if (priceJpy === 0) continue;
      candidates.push({
        price: priceJpy,
        imageUrl: item?.image?.imageUrl ?? item?.thumbnailImages?.[0]?.imageUrl ?? '',
        title: item?.title ?? '',
      });
    }

    // 22時間キャッシュ
    await kvSet(cacheKey, candidates, 22 * 3600);
    console.log(`  [eBay API #${ebayApiCallsToday}] ${enQuery.slice(0, 40)} → ${candidates.length} candidates`);
    await sleep(300); // eBayレート制限
    return candidates;
  } catch { return []; }
}

// ========== ③ Gemini画像マッチング ==========
let geminiCallsToday = 0;
const GEMINI_DAILY_LIMIT = 1400;

async function isImageMatch(rakutenUrl, ebayUrl) {
  if (!GEMINI_API_KEY || !rakutenUrl || !ebayUrl) return true;
  if (geminiCallsToday >= GEMINI_DAILY_LIMIT) return true;

  try {
    const [r1, r2] = await Promise.all([
      fetch(rakutenUrl, { signal: AbortSignal.timeout(5000) }),
      fetch(ebayUrl, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (!r1.ok || !r2.ok) return true;

    const [b1, b2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
    const body = {
      contents: [{
        parts: [
          { text: 'Are these two product images showing the EXACT SAME product — same item name, same edition, same set, same version? Do NOT say YES if they are merely similar or from the same series. Answer YES only if you are highly confident they are identical products. Reply ONLY with YES or NO.' },
          { inlineData: { mimeType: r1.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(b1).toString('base64') } },
          { inlineData: { mimeType: r2.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(b2).toString('base64') } },
        ],
      }],
      generationConfig: { maxOutputTokens: 4, temperature: 0 },
    };

    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }
    );
    geminiCallsToday++;
    if (!gr.ok) return true;
    const gd = await gr.json();
    const answer = gd?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() ?? '';
    return answer.startsWith('YES');
  } catch { return true; }
}

// ========== IQR法で外れ値除去 ==========
function calcRobustAverage(prices) {
  if (prices.length < 5) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const valid = sorted.filter(p => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
  if (valid.length < 3) return null;
  return { avg: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length), count: valid.length };
}

// ========== 利益計算 ==========
function calcProfit(rakutenPrice, ebayAvgJpy, pointAmount) {
  const effectiveBuy = rakutenPrice - pointAmount;
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuy - ebayFee - SHIPPING_COST_JPY;
  return { profit, profitRate: Math.round((profit / effectiveBuy) * 100) };
}

// ========== カテゴリ推定 ==========
function guessCategory(title) {
  if (/ポケモン|遊戯王|デュエルマスターズ|トレカ|カード/i.test(title)) return 'トレカ';
  if (/ガンプラ|ガンダム|HG|MG|RG|PG|1\/100|1\/144/i.test(title)) return 'ガンプラ';
  if (/LEGO|レゴ/i.test(title)) return 'LEGO';
  if (/フィギュア|ねんどろいど|Nendoroid|figma|プライズ/i.test(title)) return 'フィギュア';
  if (/Nintendo Switch|PS5|Xbox/i.test(title)) return 'ゲーム機';
  if (/amiibo|アミーボ|ゲームソフト/i.test(title)) return 'ゲーム';
  if (/腕時計|Watch|Seiko|Citizen|Casio|Gショック/i.test(title)) return '腕時計';
  if (/カメラ|レンズ|Canon|Nikon|Fujifilm/i.test(title)) return 'カメラ';
  if (/コスメ|香水|スキンケア|資生堂|ランコム|シャネル/i.test(title)) return 'コスメ';
  if (/トミカ|プラレール|シルバニア/i.test(title)) return 'おもちゃ';
  return 'その他';
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
          Referer: 'https://resale-research-app.vercel.app/',
          Origin: 'https://resale-research-app.vercel.app',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];
    return (await res.json()).Items ?? [];
  } catch { return []; }
}

// ========== メイン処理 ==========
async function main() {
  console.log(`\n🚀 refresh.mjs 開始 ${new Date().toISOString()}`);
  const startedAt = Date.now();

  // Phase 1: 楽天商品取得（全キーワード × 2ページ）
  console.log('\n📦 Phase 1: 楽天商品取得...');
  const seen = new Set();
  const rakutenProducts = [];

  for (const keyword of SEARCH_KEYWORDS) {
    for (const page of [1, 2]) {
      const items = await fetchRakutenPage(keyword, page);
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000 || seen.has(it.itemCode)) continue;
        if (EXCLUDE_PATTERN.test(it.itemName)) continue;
        seen.add(it.itemCode);
        rakutenProducts.push(it);
      }
      await sleep(1100); // 楽天API: 1リクエスト/秒
    }
    console.log(`  [楽天] "${keyword.slice(0, 30)}" → 累計 ${rakutenProducts.length}件`);
  }

  console.log(`\n✅ 楽天取得完了: ${rakutenProducts.length}件`);

  // Phase 2: 事前フィルタ（レビュー数5件以上を優先してソート）
  const filtered = rakutenProducts
    .filter(it => it.reviewCount >= 3)  // レビューが少なすぎる商品を除外
    .sort((a, b) => b.reviewCount - a.reviewCount);  // レビュー多い順（需要がある商品優先）

  console.log(`\n🔍 Phase 2: eBay比較 (${filtered.length}件 → 上位からeBay確認)...`);

  // Phase 3: eBay比較 → Gemini確認
  const profitableProducts = [];

  for (const it of filtered) {
    const enQuery = toEnglishQuery(it.itemName);
    if (!enQuery || enQuery.length < 5) continue;
    if (EXCLUDE_PATTERN.test(it.itemName)) continue;

    const candidates = await fetchEbayCandidates(enQuery);
    if (candidates.length === 0) continue;

    // ③ Gemini画像確認（上位5件のみ）
    const rakutenImg = it.mediumImageUrls?.[0]?.imageUrl || it.smallImageUrls?.[0]?.imageUrl || '';
    let verified;

    if (GEMINI_API_KEY && rakutenImg && geminiCallsToday < GEMINI_DAILY_LIMIT) {
      const top5 = candidates.slice(0, 5);
      const checks = await Promise.all(
        top5.map(c => c.imageUrl ? isImageMatch(rakutenImg, c.imageUrl) : Promise.resolve(false))
      );
      const geminiPassed = top5.filter((_, i) => checks[i]);
      verified = geminiPassed.length >= 3 ? geminiPassed : [...geminiPassed, ...candidates.slice(5)];
    } else {
      verified = candidates;
    }

    const prices = verified.map(c => c.price);
    const result = calcRobustAverage(prices);
    if (!result) continue;

    const pointAmount = Math.floor(it.itemPrice * (it.pointRate ?? 1) / 100);
    const { profit, profitRate } = calcProfit(it.itemPrice, result.avg, pointAmount);

    if (profit < 500 || profitRate < 10 || profitRate > 500) continue;

    profitableProducts.push({
      id: it.itemCode,
      title: it.itemName,
      imageUrl: rakutenImg,
      category: guessCategory(it.itemName),
      source: {
        site: 'rakuten',
        siteName: '楽天',
        price: it.itemPrice,
        url: it.affiliateUrl || it.itemUrl,
        pointRate: it.pointRate ?? 1,
        pointAmount,
      },
      isNew: it.itemName.includes('新品') || it.itemName.includes('未開封'),
      coreKeyword: it.itemName.split(/\s+/).slice(0, 5).join(' '),
      ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(enQuery)}&LH_Complete=1&LH_Sold=1`,
      realAvgPrice: result.avg,
      realProfit: profit,
      realProfitRate: profitRate,
      realCount: result.count,
    });

    console.log(`  💰 ${profitRate}% 利益: ${it.itemName.slice(0, 40)}`);
  }

  // 利益率降順でソートしてKVに保存
  profitableProducts.sort((a, b) => b.realProfitRate - a.realProfitRate);
  const top100 = profitableProducts.slice(0, 100);

  await kvSet('profitable_products', top100, 8 * 3600); // 8時間TTL（次の実行まで）
  await kvSet('last_updated', new Date().toISOString(), 8 * 3600);
  await kvSet('refresh_stats', {
    rakutenCount: rakutenProducts.length,
    filteredCount: filtered.length,
    profitableCount: profitableProducts.length,
    savedCount: top100.length,
    ebayApiCalls: ebayApiCallsToday,
    geminiCalls: geminiCallsToday,
    elapsedMin: Math.round((Date.now() - startedAt) / 60000),
    runAt: new Date().toISOString(),
  }, 8 * 3600);

  console.log(`
✨ 完了!
  楽天取得: ${rakutenProducts.length}件
  フィルタ後: ${filtered.length}件
  利益商品: ${profitableProducts.length}件 → 上位${top100.length}件を保存
  eBay API呼出: ${ebayApiCallsToday}回
  Gemini呼出: ${geminiCallsToday}回
  所要時間: ${Math.round((Date.now() - startedAt) / 60000)}分
`);
}

main().catch(e => { console.error(e); process.exit(1); });
