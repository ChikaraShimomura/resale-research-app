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
  "任天堂": "Nintendo", "ニンテンドー": "Nintendo", "ニンテンドウ": "Nintendo",
  "ソニー": "Sony", "プレイステーション": "PlayStation", "プレステ": "PlayStation",
  "セガ": "Sega", "カプコン": "Capcom", "コナミ": "Konami",
  "バンダイ": "Bandai", "バンダイナムコ": "Bandai Namco",
  "スクウェアエニックス": "Square Enix",
  "レゴ": "LEGO", "タカラトミー": "Takara Tomy", "トミカ": "Tomica",
  "コトブキヤ": "Kotobukiya", "グッドスマイル": "Good Smile Company",
  "マックスファクトリー": "Max Factory", "アルター": "Alter",
  "メガハウス": "MegaHouse", "フリーイング": "FREEing",
  "ポケモン": "Pokemon", "ポケットモンスター": "Pokemon",
  "ポケモンカード": "Pokemon Card", "ポケモンカードゲーム": "Pokemon TCG",
  "遊戯王": "Yu-Gi-Oh", "デュエルマスターズ": "Duel Masters",
  "ドラゴンボール": "Dragon Ball", "ナルト": "Naruto", "ボルト": "Boruto",
  "進撃の巨人": "Attack on Titan", "鬼滅の刃": "Demon Slayer",
  "呪術廻戦": "Jujutsu Kaisen", "エヴァンゲリオン": "Evangelion",
  "ガンダム": "Gundam", "ゴジラ": "Godzilla",
  "キヤノン": "Canon", "ニコン": "Nikon",
  "フジフイルム": "Fujifilm", "オリンパス": "Olympus", "パナソニック": "Panasonic",
  "資生堂": "Shiseido", "花王": "Kao", "ランコム": "Lancome",
  "セイコー": "Seiko", "シチズン": "Citizen", "カシオ": "Casio",
  "初音ミク": "Hatsune Miku", "ねんどろいど": "Nendoroid",
  "ワンピース": "One Piece", "シャネル": "Chanel", "ディオール": "Dior",
  "ジョーマローン": "Jo Malone", "イヴサンローラン": "Yves Saint Laurent",
  "グッチ": "Gucci", "ルイヴィトン": "Louis Vuitton",
  "ワンピースカード": "One Piece Card", "デュエマ": "Duel Masters",
  "プリキュア": "Pretty Cure", "セーラームーン": "Sailor Moon",
  "ドラえもん": "Doraemon", "リラックマ": "Rilakkuma",
  "スターウォーズ": "Star Wars", "マーベル": "Marvel",
  "アベンジャーズ": "Avengers", "ハリーポッター": "Harry Potter",
  "マインクラフト": "Minecraft", "スプラトゥーン": "Splatoon",
  "ゼルダ": "Zelda", "マリオ": "Mario", "カービィ": "Kirby",
  "ピカチュウ": "Pikachu", "イーブイ": "Eevee",
};

// ========== 商品名専用辞書（ブランド辞書より先に適用） ==========
const PRODUCT_TERMS_JP_TO_EN = {
  // Pokemon TCG 拡張パック名
  "黒炎の支配者": "Obsidian Flames",
  "スノーハザード": "Snow Hazard",
  "クレイバースト": "Paldea Evolved",
  "バイオレットex": "Violet ex",
  "スカーレットex": "Scarlet ex",
  "サイバージャッジ": "Cyber Judge",
  "ワイルドフォース": "Wild Force",
  "ステラミラクル": "Stellar Miracle",
  "ナイトワンダラー": "Night Wanderer",
  "レイジングサーフ": "Raging Surf",
  "テラスタルフェスティバル": "Terastal Festival",
  "マスカーニャex": "Meowscarada ex",
  "パラドックスリフト": "Paradox Rift",
  "VSTARユニバース": "VSTAR Universe",
  "ハイクラスパック": "High Class Pack",
  "スカーレット": "Scarlet",
  "バイオレット": "Violet",
  // Yu-Gi-Oh
  "リンクヴレインズ": "Link Vrains",
  "フォトン・ハイパーノヴァ": "Photon Hypernova",
  "デュエリストパック": "Duelist Pack",
  // Gunpla
  "マスターグレード": "Master Grade",
  "リアルグレード": "Real Grade",
  "パーフェクトグレード": "Perfect Grade",
  "ハイグレード": "High Grade",
  // General
  "未開封": "sealed",
  "新品": "new",
  "限定版": "limited edition",
  "限定": "limited",
  "拡張パック": "booster box",
  "シュリンク": "shrink wrapped",
  "シュリンク付": "shrink wrapped",
  "コレクターズセット": "collectors set",
  "スターターセット": "starter set",
  "スターターデッキ": "starter deck",
  "ニンテンドースイッチ": "Nintendo Switch",
  "スイッチ": "Nintendo Switch",
  "国内正規品": "",
  "正規品": "",
};

// ========== タイトル → 英語クエリ変換（改良版） ==========
function toEnglishQuery(jpTitle) {
  // Step1: 装飾ノイズを除去
  let clean = jpTitle
    .replace(/【[^】]*】/g, ' ')       // 【送料無料】など
    .replace(/〔[^〕]*〕/g, ' ')
    .replace(/今だけ[^\s]*/g, '')
    .replace(/\d+[%％]OFF[^\s]*/g, '')
    .replace(/\d+月\d+日[^\s]*/g, '')
    .replace(/送料無料/g, '')
    .replace(/ポイント\d+[倍%]?/g, '')
    .replace(/在庫[^\s]*/g, '')
    .replace(/即納|即日発送|翌日発送/g, '');

  // Step2: タイトル中の英数字コードを最初に抽出（型番・JAN・モデル番号）
  //        例: "HACPARZGA/A", "MG-1234", "4902370536485"
  const productCodes = [];
  const codeMatches = clean.match(/[A-Z]{2,}[A-Z0-9\-\/]{2,}|(?<![A-Za-z])\d{8,}(?![A-Za-z])/g) ?? [];
  for (const code of codeMatches) {
    if (code.length >= 4) productCodes.push(code);
  }

  // Step3: 商品名辞書を適用（拡張パック名など）
  for (const [jp, en] of Object.entries(PRODUCT_TERMS_JP_TO_EN)) {
    const escaped = jp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(escaped, 'g'), en ? ` ${en} ` : ' ');
  }

  // Step4: ブランド辞書を適用
  for (const [jp, en] of Object.entries(BRAND_JP_TO_EN)) {
    clean = clean.replace(new RegExp(jp, 'g'), ` ${en} `);
  }

  // Step5: 残った日本語・記号を除去
  clean = clean
    .replace(/[぀-ゟ゠-ヿ一-鿿＀-￯]/g, ' ')
    .replace(/[^\w\s\-\.\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Step6: トークンを組み合わせ（型番コード優先、重複排除、最大10語）
  const words = clean.split(' ').filter(w => w.length >= 2);
  const allTokens = [...productCodes, ...words];
  const seen = new Set();
  const unique = allTokens.filter(t => {
    const tl = t.toLowerCase();
    if (seen.has(tl)) return false;
    seen.add(tl);
    return true;
  });

  return unique.slice(0, 10).join(' ');
}

// ========== テキストマッチスコア（①④） ==========
function combinedMatchScore(queryWords, queryLower, ebayTitle) {
  const ebayLower = ebayTitle.toLowerCase();

  // ①前方: クエリ語 → eBayタイトル（重要語は重み2倍）
  const importantPattern = /^\d{3,}$|[A-Z]{2,}\d|\d[A-Z]{2,}|sealed|limited|master|grade/i;
  let fwMatch = 0, fwTotal = 0;
  for (const w of queryWords) {
    if (w.length < 2) continue;
    const weight = importantPattern.test(w) ? 2 : 1;
    fwTotal += weight;
    if (ebayLower.includes(w.toLowerCase())) fwMatch += weight;
  }
  const forward = fwTotal === 0 ? 0 : fwMatch / fwTotal;

  // ④逆方向: eBayタイトル語 → クエリ
  const noiseWords = new Set([
    'new','the','for','and','with','set','box','lot','sealed','pack',
    'bag','case','japan','japanese','from','ship','fast','free','shipping',
    'item','buy','sale','brand','official','limited','edition','ver','version',
  ]);
  const ebayWords = ebayTitle.split(/\s+/)
    .filter(w => /^[A-Za-z]{3,}$/.test(w) || /[A-Za-z]\d|\d[A-Za-z]/.test(w) || /^\d{3,}$/.test(w))
    .map(w => w.toLowerCase())
    .filter(w => !noiseWords.has(w));
  const reverse = ebayWords.length === 0 ? 0 :
    ebayWords.filter(w => queryLower.includes(w)).length / ebayWords.length;

  // スケール比・型番の完全一致はボーナス（即通過）
  const hasScale = (queryLower.match(/\d+\/\d+/g) ?? []).some(s => ebayLower.includes(s));
  const hasCode  = (queryLower.match(/[a-z]{2,}\d{2,}|\d{2,}[a-z]{2,}/g) ?? [])
                    .some(s => ebayLower.includes(s));
  if (hasScale || hasCode) return 1.0;

  return forward * 0.6 + reverse * 0.4;
}

// ========== JANコード取得（楽天APIフィールド優先 → タイトル抽出フォールバック） ==========
function extractJan(it) {
  // 楽天APIのjanCodeフィールドを最優先（一番確実）
  const fromField = it.jan || it.janCode || it.itemJan || null;
  if (fromField && /^\d{8}$|^\d{13}$/.test(String(fromField).trim())) {
    return String(fromField).trim();
  }
  // タイトルから13桁 or 8桁のバーコードを抽出（フォールバック）
  const m = (it.itemName || '').match(/(?<![0-9])(\d{13}|\d{8})(?![0-9])/g) ?? [];
  return m[0] ?? null;
}

// ========== 案B: Geminiでクエリ生成（テキストのみ・高速） ==========
let geminiQueryCallsToday = 0;
const GEMINI_QUERY_LIMIT = 500; // クエリ生成用

async function generateEbayQuery(jpTitle) {
  if (!GEMINI_API_KEY || geminiQueryCallsToday >= GEMINI_QUERY_LIMIT) return null;

  // キャッシュ確認（同じ商品名なら再利用）
  const cacheKey = `gemini_query:${ebayQueryHash(jpTitle)}`;
  const cached = await kvGet(cacheKey);
  if (cached && typeof cached === 'string') return cached;

  try {
    const body = {
      contents: [{
        parts: [{
          text: `You are an eBay search expert. Convert this Japanese product title to the best English eBay search query (max 10 words, no Japanese characters). Return ONLY the search query, nothing else.\n\nJapanese title: ${jpTitle}`,
        }],
      }],
      generationConfig: { maxOutputTokens: 30, temperature: 0 },
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }
    );
    geminiQueryCallsToday++;
    if (!res.ok) return null;
    const data = await res.json();
    const query = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!query || query.length < 3) return null;

    // 24時間キャッシュ
    await kvSet(cacheKey, query, 24 * 3600);
    return query;
  } catch { return null; }
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

// ========== 案A: eBay GTIN（JANコード）検索 ==========
let ebayApiCallsToday = 0;
const EBAY_DAILY_LIMIT = 4800;

async function fetchEbayByGtin(jan) {
  if (ebayApiCallsToday >= EBAY_DAILY_LIMIT) return [];

  const cacheKey = `ebay_gtin:${jan}`;
  const cached = await kvGet(cacheKey);
  if (cached && Array.isArray(cached)) {
    console.log(`  [GTIN cache] ${jan}`);
    return cached;
  }

  const token = await getEbayToken();
  if (!token) return [];

  // Sold Listings（落札済み）を Browse API で取得
  // filter に lastSoldDate があるバージョンを試みる
  // Browse API は sold items を直接フィルタできないので Finding API の代替として
  // まずアクティブ出品でGTIN一致を取り、価格分布の参考にする
  const params = new URLSearchParams({
    gtin: jan,
    filter: 'buyingOptions:{FIXED_PRICE|AUCTION},conditions:{NEW|LIKE_NEW|USED_EXCELLENT}',
    limit: '50',
    fieldgroups: 'COMPACT',
  });

  try {
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }, signal: AbortSignal.timeout(8000) }
    );
    ebayApiCallsToday++;
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.itemSummaries ?? [];
    const candidates = items.flatMap(item => {
      const price = parseFloat(item?.price?.value);
      const currency = item?.price?.currency;
      if (isNaN(price) || price <= 0) return [];
      const priceJpy = currency === 'USD' ? Math.round(price * USD_TO_JPY)
                     : currency === 'JPY' ? Math.round(price) : 0;
      if (priceJpy === 0) return [];
      return [{ price: priceJpy, imageUrl: item?.image?.imageUrl ?? '', title: item?.title ?? '' }];
    });

    await kvSet(cacheKey, candidates, 22 * 3600);
    console.log(`  [eBay GTIN #${ebayApiCallsToday}] JAN:${jan} → ${candidates.length} 件`);
    await sleep(300);
    return candidates;
  } catch { return []; }
}

// ========== eBay Browse API: テキストマッチ候補（キャッシュ付き） ==========
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
    filter: 'buyingOptions:{FIXED_PRICE},conditions:{NEW|LIKE_NEW|USED_EXCELLENT}',
    sort: 'bestMatch',
    limit: '50',
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
    if (EXCLUDE_PATTERN.test(it.itemName)) continue;

    const rakutenImg = it.mediumImageUrls?.[0]?.imageUrl || it.smallImageUrls?.[0]?.imageUrl || '';
    let candidates = [];
    let searchMethod = '';
    let enQuery = '';

    // ① JANコードでeBay GTIN検索（最優先・精度最高）
    const jan = extractJan(it);
    if (jan) {
      candidates = await fetchEbayByGtin(jan);
      searchMethod = `GTIN:${jan}`;
    }

    // ② JANなし or GTIN結果0 → テキスト検索フォールバック
    if (candidates.length === 0) {
      enQuery = toEnglishQuery(it.itemName);
      if (!enQuery || enQuery.length < 5) continue;
      candidates = await fetchEbayCandidates(enQuery);
      searchMethod = `TEXT:"${enQuery.slice(0, 30)}"`;
    }

    if (candidates.length === 0) continue;
    console.log(`  [${searchMethod}] ${it.itemName.slice(0, 35)}`);

    // ③ Gemini画像確認（上位5件のみ）
    // GTINの場合は既に一致精度が高いのでGemini確認を緩める
    let verified;
    if (jan) {
      // GTINは高精度なのでGemini確認なしでそのまま使う
      verified = candidates;
    } else if (GEMINI_API_KEY && rakutenImg && geminiCallsToday < GEMINI_DAILY_LIMIT) {
      const top5 = candidates.slice(0, 5);
      const checks = await Promise.all(
        top5.map(c => c.imageUrl ? isImageMatch(rakutenImg, c.imageUrl) : Promise.resolve(false))
      );
      const geminiPassed = top5.filter((_, i) => checks[i]);
      // テキスト検索はGemini確認必須（2件以上一致した場合のみ採用）
      verified = geminiPassed.length >= 2 ? geminiPassed : [];
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
      ebaySoldUrl: jan
        ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(it.itemName.slice(0,60))}&LH_Complete=1&LH_Sold=1`
        : `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(enQuery)}&LH_Complete=1&LH_Sold=1`,
      realAvgPrice: result.avg,
      realProfit: profit,
      realProfitRate: profitRate,
      realCount: result.count,
    });

    console.log(`  💰 ${profitRate}% 利益: ${it.itemName.slice(0, 40)}`);
  }

  // 利益率降順でソートしてKVに保存
  profitableProducts.sort((a, b) => b.realProfitRate - a.realProfitRate);

  await kvSet('profitable_products', profitableProducts, 8 * 3600); // 8時間TTL（次の実行まで）
  await kvSet('last_updated', new Date().toISOString(), 8 * 3600);
  await kvSet('refresh_stats', {
    rakutenCount: rakutenProducts.length,
    filteredCount: filtered.length,
    profitableCount: profitableProducts.length,
    savedCount: profitableProducts.length,
    ebayApiCalls: ebayApiCallsToday,
    geminiCalls: geminiCallsToday,
    elapsedMin: Math.round((Date.now() - startedAt) / 60000),
    runAt: new Date().toISOString(),
  }, 8 * 3600);

  console.log(`
✨ 完了!
  楽天取得: ${rakutenProducts.length}件
  フィルタ後: ${filtered.length}件
  利益商品: ${profitableProducts.length}件 → 全件を保存
  eBay API呼出: ${ebayApiCallsToday}回
  Gemini画像確認: ${geminiCallsToday}回
  所要時間: ${Math.round((Date.now() - startedAt) / 60000)}分
`);
}

main().catch(e => { console.error(e); process.exit(1); });
