#!/usr/bin/env node
// scripts/refresh.mjs — GitHub Actions バックグラウンド処理
// フロー: eBay日本発送売れ済み → 日本語KW変換 → 楽天検索 → 画像マッチ → 利益計算

// ========== 設定 ==========
const RAKUTEN_APP_ID      = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY  = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const EBAY_APP_ID         = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET  = process.env.EBAY_CLIENT_SECRET;
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
// 互換バンド/社外ストラップ/交換部品 等の「別物アクセサリ」。純正本体を安い部品に誤マッチさせる事故を防ぐ
// （監査で腕時計の互換バンド誤マッチが多発）。純正も「バンド/ベルト」と書くため、裸の語ではなく
// “互換・社外・交換用・〇〇用ベルト・バネ棒/遊環”等のアフター品シグナルだけで弾く。
const PART_EXCLUDE = /互換|社外|交換用|交換\s*(?:ベルト|バンド|ストラップ)|替え\s*(?:ベルト|バンド|ストラップ)|汎用|バネ棒|遊環|尾錠単体|NATO\s*(?:ベルト|ストラップ|バンド)|ZULU|(?:対応|適合|用)\s*(?:ベルト|バンド|ストラップ)/i;
// 複数個セット/まとめ売り。単品のeBay出品と数量が食い違う誤マッチを防ぐ。
const SET_EXCLUDE = /\d+\s*(?:点|個|本|体|枚)\s*セット|\d+\s*(?:点|個|本|体)\s*まとめ|まとめ売り|セット売り|\d+\s*個入り|詰め合わせ/i;
// 中古/ユーズド/ジャンク。新品eBay相場と比較すると利益が過大に見える誤検知の温床（精度監査で確認）。
// 初心者向け・低リスク方針に合わせ、中古の楽天品はカタログから除外する。detectCondition と同じ語で判定。
const USED_EXCLUDE = /中古|ユーズド|used|ジャンク/i;
// 【ユーザー厳命】関税問題/国際郵便で送れない航空危険物等は絶対にカタログ対象にしない。
// 明確な危険物ワードに限定（腕時計の「電池/ソーラー」やスプレーボトル等の正常品を巻き込まないよう bareの電池/スプレーは使わない）。
const PROHIBITED_EXCLUDE = /香水|フレグランス|オードトワレ|オーデコロン|パフューム|perfume|cologne|fragrance|eau de|スプレー缶|エアゾール|エアゾル|ヘアスプレー|制汗スプレー|殺虫スプレー|aerosol|モバイルバッテリー|リチウムイオンバッテリー|power\s?bank|ライター|チャッカマン|lighter|花火|火薬|爆竹|firework|カセットボンベ|ガスボンベ|gas\s?canister|マニキュア|除光液|ネイルリムーバー|nail\s?polish|消毒用アルコール|エタノール|医薬品|劇薬|農薬/i;

// タイトルから「数量(個数)」を推定する。既定1。楽天が複数パック/セットなのにeBay単品と比較され
// 価格(=利益)が狂う事故を防ぐ。ml/g等の単位・型番・版数(Ver.2/No.264)は数量と誤認しない設計。
function quantityOf(title) {
  const s = title || "";
  let q = 1;
  const bump = (n) => { const v = parseInt(n, 10); if (v >= 2 && v <= 50) q = Math.max(q, v); };
  let m;
  // 日本語: 数字 + 個数カウンタ（個/本/点/枚/コ/ヶ/組/袋/箱/パック/セット）。「N個入り」「Nセット」も含む。
  const jp = /(\d{1,2})\s*(?:個|本|点|枚|コ|ヶ|組|袋|箱|パック|セット)/g;
  while ((m = jp.exec(s))) bump(m[1]);
  if (/(?:^|[^ァ-ヶー])ペア(?![ンミ])/.test(s)) q = Math.max(q, 2); // ペア=2（ペイント/ペンは除外）
  // 英語(eBay): lot of N / set of N / pack of N / N pcs / N pieces / N-pack
  const en = /(?:lot|set|pack)\s*of\s*(\d{1,2})|(\d{1,2})\s*(?:pcs|pieces|[- ]pack)\b/gi;
  while ((m = en.exec(s))) bump(m[1] || m[2]);
  // ×N（掛け算の数量。寸法[150x150]誤検出を避け 2〜20 に限定）
  const x = /[×x]\s*([2-9]|1\d|20)\b/gi;
  while ((m = x.exec(s))) bump(m[1]);
  return q;
}
// ① 楽天検索のNGKeyword（除外語）。社外/互換/部品/アクセサリ/シール等の別物を“拾う前に”除外。
//   ※「バンド/ベルト」単体は純正時計名にも出るため入れない(recall維持)。バンド誤マッチは価格比とPART_EXCLUDEで対処。
const NG_KEYWORDS = '互換 社外 交換用 汎用 スリーブ ローダー 保護フィルム バネ棒 遊環 シール ステッカー';
// ② eBay種ジャンル(EBAY_JP_QUERIESのname) → 期待する楽天側ジャンル(guessCategory)。明確な別ジャンル混入を弾く。
const EXPECTED_GENRE = {
  'ポケモンカード': 'トレカ', '遊戯王': 'トレカ', 'ワンピースカード': 'トレカ',
  'ガンプラMG': 'ガンプラ', 'ガンプラHG': 'ガンプラ', 'ねんどろいど': 'フィギュア',
  'LEGO': 'LEGO', 'セイコー': '腕時計', 'Gショック': '腕時計', '資生堂': 'コスメ',
  'トミカ': 'おもちゃ', 'アミーボ': 'ゲーム',
  // recall拡張ぶん。値は guessCategory の実測出力に合わせる（誤った別ジャンル除外で良マッチを落とさないため）。
  // ※amiiboカード=ゲーム / METAL BUILD=ガンプラ(ガンダム判定) / ポケセンぬいぐるみ=トレカ(ポケモン判定) は実測で補正。
  'DBフュージョンワールド': 'トレカ', 'ヴァイス ホロライブ': 'トレカ', 'デジモンカード': 'トレカ',
  'どうぶつの森amiiboカード': 'ゲーム',
  'ガンプラRG': 'ガンプラ', 'ガンプラPG': 'ガンプラ', 'ガンプラEG': 'ガンプラ', '30MM ACVI': 'ガンプラ',
  'SHFドラゴンボール': 'フィギュア', 'SHF鬼滅': 'フィギュア', 'figma': 'フィギュア', 'POP UP PARADE': 'フィギュア',
  'METAL BUILD': 'ガンプラ', 'メガミ/FAガール': 'フィギュア',
  'オシアナス': '腕時計', 'アテッサ': '腕時計', 'オリエント バンビーノ': '腕時計',
  'アネッサ': 'コスメ', 'ハダラボ極潤': 'コスメ', 'キャンメイク': 'コスメ', 'SK-II': 'コスメ',
  'ベイブレードX': 'おもちゃ', 'ミニ四駆': 'おもちゃ', 'ポケセンぬいぐるみ': 'トレカ',
};
// ⑤ 価格比サニティの上限（eBay最安 > 楽天価格 × この倍率 → 安い部品×高い本体等の誤マッチ疑いで除外）。
const PRICE_RATIO_MAX = 8;
// 利益率(%)の下限。これ以下は一覧に出さない（ユーザー指定: 10%以下は除外）。新規・既存の両方に適用。
const PROFIT_RATE_FLOOR = 10;

// ========== eBayクエリハッシュ ==========
function ebayQueryHash(query) {
  let h = 0;
  for (const c of query) { h = Math.imul(31, h) + c.charCodeAt(0) | 0; }
  return Math.abs(h).toString(36);
}

// ========== 利益計算 ==========
function calcProfit(rakutenPrice, ebayAvgJpy, pointAmount, domesticShipJpy = 0) {
  // 原価 = 楽天価格 + 国内送料(ショップ→自分) - 獲得ポイント。ポイントは商品代に対して付くので送料には掛けない。
  const effectiveBuy = rakutenPrice + domesticShipJpy - pointAmount;
  if (effectiveBuy <= 0) return { profit: 0, profitRate: 0 };
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuy - ebayFee - SHIPPING_COST_JPY;
  return { profit, profitRate: Math.round((profit / effectiveBuy) * 100) };
}

// 国内送料(楽天ショップ→自分)の概算。送料込み(postageFlag=0)は0。
// 楽天APIは正確な送料額を返さないため、カテゴリの典型サイズで保守的に概算する（過小利益＝安全側）。
// 送料別の商品はこの分だけ利益が下がり、閾値割れすれば落ちる＝より正直な利益表示になる。
const DOMESTIC_SHIP_JPY = {
  'トレカ': 350, 'コスメ': 500, 'ゲーム': 400, 'フィギュア': 800, 'ガンプラ': 800,
  'LEGO': 1000, '腕時計': 600, 'ゲーム機': 1100, 'カメラ': 1000, 'おもちゃ': 700, 'その他': 700,
};
function domesticShipping(category, postageFlag, title) {
  // 楽天の商品検索APIは「正確な送料額」を返さない（postageFlag=送料込み(0)/送料別(1)のみ。金額フィールド無し）。
  // 正確に算出: 送料無料/込みが明示 or postageFlag=0 → ¥0。送料別(=1)はカテゴリ別の概算(APIに正確な額が無いため)。
  if (/送料無料|送料込/.test(title || '')) return 0;
  if (Number(postageFlag) === 0) return 0;
  return DOMESTIC_SHIP_JPY[category] ?? 700;
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
    NGKeyword: NG_KEYWORDS, // ① 社外/互換/部品/アクセサリ等を検索段階で除外
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

// ========== 画像マッチ（ジャンル別・識別子重視 / Claude一本化: Haiku下調べ＋Sonnet確認） ==========
// 別変種(同キャラ別番号・同機体別グレード・同ライン別容量・正規vs互換 等)をSAMEと誤る偽陽性が相場/利益を狂わせる。
// 対策: 画像を高解像度化＋タイトル文脈＋識別子を読ませる保守プロンプト。実画像検証で旧プロンプトの偽陽性3→0・取りこぼし0。
// 【合議】A(下調べ): 安価な Haiku で判定。NOなら即除外。B(確認): HaikuがYESの候補だけ上位の Sonnet で確認し、
//   両方YESの時だけ採用＝偽陽性を上位モデルで潰す。AIベンダーは Anthropic に一本化（Gemini廃止）。
let haikuCallsToday = 0;
let sonnetCallsToday = 0;
let haikuFailToday = 0; // 観測フック: Haiku不通(Anthropic到達不可)の回数。全滅時は未検証で商品が通る(fail-open)ため要警戒。
// Sonnet確認の実行あたり上限回数（巨大リビルド時のコスト暴走を防ぐブレーキ）。既定300=通常運用は常に確認。
// 最小コストで回したい時は IMG_MATCH_SONNET_BUDGET=0 で Haiku 単独運用に落とせる。
const MAX_SONNET_PER_RUN = Number(process.env.IMG_MATCH_SONNET_BUDGET ?? 300);

// 楽天サムネは _ex=128x128 等で型番/容量の文字が読めない→拡大。eBayの s-l{N} も大判化。
function upscaleRakuten(url) { return (url || '').replace(/_ex=\d+x\d+/, '_ex=600x600'); }
function upscaleEbay(url) { return (url || '').replace(/s-l\d{2,4}/i, 's-l800'); }

// 識別子重視・保守的な厳密判定プロンプト（カテゴリ別ルール＋識別子が読めなければLOW=reject）。
function strictMatchPrompt(rakutenTitle, ebayTitle, qty) {
  return `You verify whether two photos show the EXACT SAME sellable product variant, for a resale price catalog. A wrong "same" misleads users about market price, so be conservative: if you cannot confirm the same specific variant, answer NO.
Image 1: Rakuten (Japan). Title: "${(rakutenTitle || '').slice(0, 140)}".${qty ? ` Quantity: ${qty}.` : ''}
Image 2: eBay. Title: "${(ebayTitle || '').slice(0, 140)}".
Step 1 - For EACH image, read every identifier from the image AND its title: product/character name, series, model or card number, edition/version, color, size/volume, dosage form, quantity.
Step 2 - Compare the SPECIFIC variant, not just the category:
 - Figures/amiibo/plush: same CHARACTER and version. Same series but different character = NO.
 - Trading cards: the card NUMBER and the specific card must match. Different number/rarity/edition (1st vs unlimited) = NO.
 - Model kits (Gunpla): same kit AND grade (HG/RG/MG/PG) AND version (Ver.x.x). Different grade/version = NO.
 - Cosmetics/consumables: same product line, same dosage form (lotion/milk/cream/serum), AND same size/volume (e.g. 80g vs 90g). Any difference = NO.
 - Watches/accessories: a genuine branded item is NOT the same as a generic/compatible/aftermarket item. Only treat as genuine if the titles/model numbers agree; never declare genuine from the image alone.
 - Quantity: single vs set/lot/box/bundle must match.
Step 3 - If a distinguishing identifier (grade/volume/number/edition) cannot be read in EITHER the image or the title, do NOT guess YES; set CONFIDENCE: LOW.
Reply EXACTLY in this format:
ID1: <the specific variant in image 1>
ID2: <the specific variant in image 2>
SAME_VARIANT: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}

// Anthropic ビジョン呼び出し（2画像）。失敗時 null。共通レートゲートを通す。
async function anthropicVision(model, maxTokens, promptText, img) {
  await haikuGate();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens, temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: promptText },
        { type: 'image', source: { type: 'base64', media_type: img.mt1, data: img.b1 } },
        { type: 'image', source: { type: 'base64', media_type: img.mt2, data: img.b2 } },
      ]}],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}

// strictMatchPrompt の応答を「同一(YES)かつ確信がLOWでない」かで判定。
function parseStrictSame(text) {
  return /SAME_VARIANT:\s*YES/i.test(text) && !/CONFIDENCE:\s*LOW/i.test(text);
}

// Haiku で同一判定（下調べ・主軸）。識別子重視プロンプト。true/false、キー無し・失敗時 null。
async function haikuStrict(img, rakutenTitle, ebayTitle, qty) {
  if (!ANTHROPIC_API_KEY) return null;
  const t = await anthropicVision('claude-haiku-4-5', 220, strictMatchPrompt(rakutenTitle, ebayTitle, qty), img);
  if (t === null) return null;
  haikuCallsToday++;
  return parseStrictSame(t);
}

// Sonnet で同一判定（上位モデルでの確認用）。HaikuがYESと言った候補だけに使う。true/false、失敗時 null。
async function sonnetStrict(img, rakutenTitle, ebayTitle, qty) {
  if (!ANTHROPIC_API_KEY) return null;
  const t = await anthropicVision('claude-sonnet-4-6', 220, strictMatchPrompt(rakutenTitle, ebayTitle, qty), img);
  if (t === null) return null;
  sonnetCallsToday++;
  return parseStrictSame(t);
}

async function isImageMatch(rakutenUrl, ebayUrl, opts = {}) {
  if (!rakutenUrl || !ebayUrl) return true;
  const { rakutenTitle = '', ebayTitle = '', rakutenQuantity = null } = opts;

  // キャッシュキーを v3 に更新。旧 img_match2 は「壊れたGemini→Haiku単独」時代の判定なので無効化し、
  // 新しい Haiku下調べ→Sonnet確認 の合議で全ペアを判定し直させる（BOX≠単品 等の取りこぼしを洗浄）。
  const cacheKey = `img_match3:${ebayQueryHash(rakutenUrl + ebayUrl)}`;
  const cached = await kvGet(cacheKey);
  if (cached !== null) return cached === true || cached === 'true';

  // 画像は一度だけ高解像度で取得（文字＝識別子を読めるように）。
  let img;
  try {
    const [r1, r2] = await Promise.all([
      fetch(upscaleRakuten(rakutenUrl), { signal: AbortSignal.timeout(6000) }),
      fetch(upscaleEbay(ebayUrl), { signal: AbortSignal.timeout(6000) }),
    ]);
    if (!r1.ok || !r2.ok) return true; // 取得不可は判定不能→従来通りfail-open（商品を不当に落とさない）
    const [a1, a2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
    img = {
      b1: Buffer.from(a1).toString('base64'), mt1: r1.headers.get('content-type') ?? 'image/jpeg',
      b2: Buffer.from(a2).toString('base64'), mt2: r2.headers.get('content-type') ?? 'image/jpeg',
    };
  } catch { return true; }

  // ===== Claude一本化: Haiku下調べ → Sonnet確認 =====
  // A(下調べ): 安価な Haiku で識別子判定。NOなら即除外。null(Anthropic不通)は保留=fail-open（商品を不当に落とさない）。
  // B(確認): HaikuがYESの候補だけ、上位の Sonnet で確認。両方YESの時だけ採用＝偽陽性を上位モデルで潰す。
  try {
    const hai = await haikuStrict(img, rakutenTitle, ebayTitle, rakutenQuantity);
    if (hai === null) { haikuFailToday++; return true; }  // Anthropic不通→保留(キャッシュしない=次回再評価)
    if (hai === false) {                            // Haikuが別物→確定で除外
      await kvSet(cacheKey, false, 168 * 3600);
      return false;
    }

    // hai === true。B: Sonnetで確認（誤検知を上位モデルで潰す）。
    if (sonnetCallsToday < MAX_SONNET_PER_RUN) {
      const son = await sonnetStrict(img, rakutenTitle, ebayTitle, rakutenQuantity);
      if (son === null) {                           // Sonnet不通→Haiku単独で短期採用(復旧後に再評価)
        await kvSet(cacheKey, true, 24 * 3600);
        return true;
      }
      if (son === false) console.log('  [img NG/Sonnet否決]');
      await kvSet(cacheKey, son, 168 * 3600);
      return son;
    }

    // Sonnet予算切れ(巨大リビルド等)→ Haiku単独で短期採用＋ログ（次回/予算復活で再確認）。
    console.log('  [img Sonnet予算切れ→Haiku単独で暫定採用]');
    await kvSet(cacheKey, true, 24 * 3600);
    return true;
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
  // ── recall拡張(2026-06-15): 日本→eBay輸出の高価値ライン(新品・単品・楽天入手可)を多エージェント研究で追加 ──
  { q: 'dragon ball fusion world booster box japanese sealed',                 name: 'DBフュージョンワールド' },
  { q: 'weiss schwarz hololive booster box japanese sealed',                   name: 'ヴァイス ホロライブ' },
  { q: 'digimon card game booster box japanese sealed bandai',                 name: 'デジモンカード' },
  { q: 'amiibo card animal crossing japanese sealed booster',                  name: 'どうぶつの森amiiboカード' },
  { q: 'gundam RG real grade model kit bandai japan new sealed',               name: 'ガンプラRG' },
  { q: 'gundam PG perfect grade unleashed model kit bandai japan new sealed',  name: 'ガンプラPG' },
  { q: 'gundam entry grade EG model kit bandai japan new sealed',              name: 'ガンプラEG' },
  { q: '30MM armored core VI model kit bandai japan new sealed',               name: '30MM ACVI' },
  { q: 's.h.figuarts dragon ball figure japan new sealed',                     name: 'SHFドラゴンボール' },
  { q: 's.h.figuarts demon slayer figure new japan',                          name: 'SHF鬼滅' },
  { q: 'figma figure max factory japan new sealed',                           name: 'figma' },
  { q: 'pop up parade figure good smile new japan',                           name: 'POP UP PARADE' },
  { q: 'metal build gundam bandai figure japan new sealed',                    name: 'METAL BUILD' },
  { q: 'kotobukiya megami device frame arms girl model kit japan new sealed',  name: 'メガミ/FAガール' },
  { q: 'casio oceanus watch japan new',                                       name: 'オシアナス' },
  { q: 'citizen attesa eco-drive radio watch japan new',                       name: 'アテッサ' },
  { q: 'orient bambino automatic watch japan new',                            name: 'オリエント バンビーノ' },
  { q: 'anessa perfect uv sunscreen spf50 japan new',                         name: 'アネッサ' },
  { q: 'hada labo gokujyun lotion japan new sealed',                          name: 'ハダラボ極潤' },
  { q: 'canmake makeup japan new sealed',                                     name: 'キャンメイク' },
  { q: 'sk-ii facial treatment essence japan new sealed',                      name: 'SK-II' },
  { q: 'beyblade x takara tomy booster japan new sealed',                      name: 'ベイブレードX' },
  { q: 'tamiya mini 4wd model kit japan new sealed',                          name: 'ミニ四駆' },
  { q: 'pokemon center plush japan exclusive new with tag',                    name: 'ポケセンぬいぐるみ' },
];

async function fetchEbayJapanSoldItems() {
  const cacheKey = 'ebay_jp_sold_titles_v3'; // sort=Best Matchへ変更→seedが変わるため旧キャッシュを無効化
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
      // sort指定なし＝Best Match(関連度/人気)。以前の price昇順は「最安出品=低利幅」ばかりをseedにして
      // 初回利益判定で大量脱落させていた（取得多数でも新規が増えない主因）。表示価格は別途eBay最安ベースを維持。
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
        if (PROHIBITED_EXCLUDE.test(title)) continue; // 【厳命】香水/スプレー/電池等 国際発送不可・関税問題はseed段階で除外
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
  const cacheKey = `rakuten_kw2:${ebayQueryHash(ebayTitle)}`; // 翻訳プロンプト強化に伴い旧キャッシュを無効化
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
          content: `Convert this eBay listing title into a Japanese Rakuten search keyword that finds the SAME product.
Rules:
- Keep the specific product/character name, series, model number, card number, set name and size. These decide whether the same item is found.
- Use the Japanese name for well-known brands/series (Nendoroid→ねんどろいど, Demon Slayer→鬼滅の刃, Dragon Ball→ドラゴンボール). amiibo/figma/LEGO/SK-II stay as-is. Model numbers and proper nouns may stay in latin letters.
- Drop generic filler (japan, new, sealed, lot, authentic, US seller).
- Max 6 words.
eBay title: "${ebayTitle}"
Output only the keyword.`
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
  // low = 外れ値除去後の最安（ロバストな最安）。median は併記用。
  return { median: use[Math.floor(use.length / 2)], low: use[0], count: use.length };
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

// ========== 落札価格(Marketplace Insights API) — 承認後に有効化 ==========
//
// 【現状】eBay の Marketplace Insights API (item_sales/search = 実際の落札/売却データ) は
//   申請承認制。未承認のうちは下の機能は EBAY_INSIGHTS_ENABLED で OFF にしてあり、相場は
//   従来どおり「現在出品の単品中央値(ebayMedianSinglePriceJpy)」を使う＝挙動は一切変わらない。
//
// 【承認されたら有効化する手順（これだけ）】
//   1. Vercel と GitHub Actions(refresh) の env に  EBAY_INSIGHTS_ENABLED=1  を足す。
//      ※ EBAY_APP_ID / EBAY_CLIENT_SECRET はそのまま。insights スコープは
//        getEbayInsightsToken() が「本フラグ ON のときだけ」要求するので、承認前に
//        スコープを足して本体トークン取得を壊す事故は起きない設計。
//   2. 次の refresh(CI) から、相場が「実売(落札)中央値」優先に切り替わる。
//      取れない/サンプル僅少なら自動で現在出品中央値へフォールバック。
//   3. ログ「💱 実売中央値を採用」で実際に効いているか確認する。
//   （任意）将来 UI で「相場」→「実売◯件」と出し分けるなら、marketMedianPriceJpy が返す
//     soldBased を product に通して ProductCard の表記を分岐させる。
const INSIGHTS_ENABLED = process.env.EBAY_INSIGHTS_ENABLED === '1';
const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

// insights スコープ専用トークン（本体の api_scope トークンとは別キャッシュ。
// 承認前にこのスコープを要求すると失敗するため、INSIGHTS_ENABLED のときだけ呼ぶ）。
let ebayInsightsTokenCache = null;
async function getEbayInsightsToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayInsightsTokenCache && Date.now() < ebayInsightsTokenCache.expiresAt) return ebayInsightsTokenCache.token;
  const encoded = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(INSIGHTS_SCOPE)}`,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.error(`  [Insights OAuth] HTTP ${res.status}（未承認の可能性）`); return null; }
    const data = await res.json();
    ebayInsightsTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch (e) { console.error(`  [Insights OAuth] ${e.message}`); return null; }
}

// eBay「落札(実売)中央値(JPY)」。Marketplace Insights の item_sales/search を叩く。
// セット除外＋外れ値トリムは現在出品版と同じ。24hキャッシュ。失敗/少数時は null。
async function ebaySoldMedianPriceJpy(query) {
  if (!query || !INSIGHTS_ENABLED) return null;
  const cacheKey = `sold_jpy:${ebayQueryHash(query)}`;
  const cached = await kvGet(cacheKey);
  if (cached && typeof cached === 'object' && cached.median > 0) return { ...cached, soldBased: true };
  const token = await getEbayInsightsToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({ q: query, limit: '24' });
    const res = await fetch(`https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const prices = (data?.itemSales ?? [])
      .filter(it => !PRICE_SET_RE.test(it?.title ?? ''))
      .map(it => {
        const p = it?.lastSoldPrice ?? it?.price; // Insights は lastSoldPrice（実売価格）
        const v = parseFloat(p?.value); const c = p?.currency;
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
    return result ? { ...result, soldBased: true } : null;
  } catch { return null; }
}

// 相場の中央値(JPY)。承認後(INSIGHTS_ENABLED=1)は「実売中央値」を優先し、取れない/サンプル
// 僅少なら「現在出品の単品中央値」にフォールバック。フラグOFF時は完全に従来挙動。
async function marketMedianPriceJpy(query) {
  if (INSIGHTS_ENABLED) {
    const sold = await ebaySoldMedianPriceJpy(query);
    if (sold && sold.count >= 3) { console.log('  💱 実売中央値を採用'); return sold; }
  }
  return ebayMedianSinglePriceJpy(query);
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

  // 既存カタログの国内送料を「正確な信号」で再計算（送料無料/込み=¥0・送料別=概算）し、利益を更新。
  // postageIncluded(=postageFlag0) と タイトルの送料無料/込み表記から判定。後段の利益率フィルタに反映される。
  {
    let fixed = 0;
    for (const p of dedupedProducts) {
      if (!p.source || !(p.realAvgPrice > 0) || !(p.source.price > 0)) continue;
      const ship = domesticShipping(p.category, p.source.postageIncluded ? 0 : 1, p.title);
      if (p.source.shippingJpy === ship) continue;
      p.source.shippingJpy = ship;
      const r = calcProfit(p.source.price, p.realAvgPrice, p.source.pointAmount ?? 0, ship);
      p.realProfit = r.profit; p.realProfitRate = r.profitRate;
      fixed++;
    }
    if (fixed) console.log(`  📦 国内送料を正確な信号で再計算(無料/込み=0・送料別=概算): ${fixed}件`);
  }

  // 既存の別物アクセサリ(互換バンド/社外部品)・複数個セット・価格比異常 を除外（監査で腕時計の誤マッチ多数判明）。
  {
    const before = dedupedProducts.length;
    dedupedProducts = dedupedProducts.filter(p => {
      if (p.title && (PART_EXCLUDE.test(p.title) || SET_EXCLUDE.test(p.title))) return false;
      if (p.title && USED_EXCLUDE.test(p.title)) return false; // 中古品（新品相場と比較され利益過大の誤検知）
      if (p.title && PROHIBITED_EXCLUDE.test(p.title)) return false; // 【厳命】国際発送不可・関税問題ジャンルは既存からも除去
      if (p.title && quantityOf(p.title) > 1) return false;    // 複数パック(数量>1)＝単品相場と比較され価格が狂う
      if (typeof p.realProfitRate === "number" && p.realProfitRate <= PROFIT_RATE_FLOOR) return false; // 利益率10%以下は出さない
      // ⑤ 価格比サニティ（既存にも適用）
      if (p.realAvgPrice > 0 && p.source?.price > 0 && p.realAvgPrice > p.source.price * PRICE_RATIO_MAX) return false;
      return true;
    });
    const dropped = before - dedupedProducts.length;
    if (dropped) console.log(`  🧹 互換部品/セット/中古/数量違い/価格比異常の誤マッチを除外: ${dropped}件`);
  }

  // 既存商品の相場を「eBay最安値ベース」に再評価（早く売る前提の正直な利益表示）。中央値は併記用に保持。
  // 安全装置：万一ほぼ全件(>85%)が利益消失するなら取得異常を疑い適用を見送る（最安化で件数が減るのは想定内なので閾値は高め）。
  const repriced = [];
  for (const p of dedupedProducts) {
    if (!p.coreKeyword || !p.source || !(p.realAvgPrice > 0)) continue;
    const med = await marketMedianPriceJpy(searchQueryFor(p.coreKeyword));
    if (!med || med.count < 5) continue;
    const low = med.low ?? med.median;                 // ★eBay最安ベース（旧キャッシュ対策で中央値フォールバック）
    if (low >= p.realAvgPrice) { p.realCount = med.count; p.realMedianPrice = med.median; continue; } // 下がらないなら件数/中央値だけ反映
    const r = calcProfit(p.source.price, low, p.source.pointAmount ?? 0, p.source.shippingJpy ?? 0);
    repriced.push({ p, newAvg: low, median: med.median, count: med.count, profit: r.profit, rate: r.profitRate });
  }
  const wouldDrop = repriced.filter(x => x.rate <= PROFIT_RATE_FLOOR).length;
  if (repriced.length && wouldDrop / dedupedProducts.length > 0.85) {
    console.log(`  ⚠️ 最安再評価で${wouldDrop}/${dedupedProducts.length}件が利益率${PROFIT_RATE_FLOOR}%以下(>85%)。取得異常の可能性があるため再評価を見送り。`);
  } else if (repriced.length) {
    const drop = new Set();
    let updated = 0;
    for (const x of repriced) {
      x.p.realAvgPrice = x.newAvg; x.p.realMedianPrice = x.median; x.p.realCount = x.count; x.p.realProfit = x.profit; x.p.realProfitRate = x.rate;
      if (x.rate <= PROFIT_RATE_FLOOR) drop.add(x.p.id); else updated++; // 利益率10%以下は一覧から除外
    }
    dedupedProducts = dedupedProducts.filter(p => !drop.has(p.id));
    console.log(`  💹 相場をeBay最安値で是正: ${updated}件更新 / ${drop.size}件は利益率${PROFIT_RATE_FLOOR}%以下で除外`);
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
        if (PART_EXCLUDE.test(it.itemName)) continue;     // 互換バンド/社外部品 等の別物アクセサリ
        if (SET_EXCLUDE.test(it.itemName)) continue;       // 複数個セット/まとめ売り
        if (USED_EXCLUDE.test(it.itemName)) continue;      // 中古/ユーズド/ジャンク（新品相場比較で利益過大）
        if (PROHIBITED_EXCLUDE.test(it.itemName)) continue; // 【厳命】香水/スプレー/電池/ライター等 国際発送不可・関税問題ジャンルは絶対対象外
        if (existingIds.has(it.itemCode)) continue;
        rakutenItems.push(it);
      }
      await sleep(1100);
    }

    if (rakutenItems.length === 0) return { type: 'skip', id: itemId };

    const ebayImg = ebayItem.imageUrl ?? '';

    // 楽天上位5件: 先に利益計算（算術のみ・Haiku不要）→ 利益が出る候補だけ画像マッチ（Haiku）。
    // eBay価格は確定済みなので利益判定にHaikuは不要。これで無駄な画像マッチ呼び出しを大幅削減。
    for (const rakutenItem of rakutenItems.slice(0, 10)) { // 候補を5→10に拡大（同一品の成立率=歩留まり向上）
      const rakutenImg = rakutenItem.mediumImageUrls?.[0]?.imageUrl
        || rakutenItem.smallImageUrls?.[0]?.imageUrl || '';
      if (!rakutenImg) continue; // 画像なしは商品表示にも使えないのでスキップ

      // ① 利益計算（Haiku不要）。利益が出ないものはここでスキップ＝Haiku節約
      // ポイントは楽天APIの実際の倍率を使う（base 1倍=1%）。1箇所で算出し表示・利益計算で共有。
      const pointRate = rakutenItem.pointRate ?? 1;
      const pointAmount = Math.floor(rakutenItem.itemPrice * pointRate / 100);
      const cat = guessCategory(rakutenItem.itemName);
      const shipJpy = domesticShipping(cat, rakutenItem.postageFlag, rakutenItem.itemName); // 送料別のみ国内送料を原価に算入
      const { profit, profitRate } = calcProfit(rakutenItem.itemPrice, ebayItem.priceJpy, pointAmount, shipJpy);
      if (profitRate <= PROFIT_RATE_FLOOR || profitRate > 300) continue; // 利益率10%以下/異常高は除外
      // ② カテゴリ整合: 楽天の推定ジャンルがeBay種ジャンルと明確に食い違う別物は除外（誤ジャンル混入防止）。
      const expectedGenre = EXPECTED_GENRE[ebayItem.category];
      if (expectedGenre && cat !== 'その他' && cat !== expectedGenre) continue;
      // ⑤ 価格比サニティ: eBayが楽天の規定倍率超＝安い部品×高い本体等の誤マッチ疑い→除外。
      if (ebayItem.priceJpy > rakutenItem.itemPrice * PRICE_RATIO_MAX) continue;

      // カード番号/型番が食い違う候補は別商品なので除外（同キャラ別番号カード等の誤マッチ防止）。
      // 画像マッチ前に弾くことで Haiku も節約できる。
      if (codesConflict(rakutenItem.itemName, ebayItem.title)) continue;

      // 数量(個数)が食い違う候補は除外（楽天=2本パック vs eBay=単品 等。価格基準が狂うのを防ぐ）。
      // 画像では複数パックも1個に見えるため、タイトルから数値抽出して決定論的に弾く。
      const rQty = quantityOf(rakutenItem.itemName);
      if (rQty !== quantityOf(ebayItem.title)) continue;

      // ② 利益が出る候補だけ画像マッチ（Haiku）で同一商品か検証
      if (ebayImg) {
        const matched = await isImageMatch(rakutenImg, ebayImg, { rakutenTitle: rakutenItem.itemName, ebayTitle: ebayItem.title, rakutenQuantity: rQty });
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

      // 相場は「eBay最安値」ベース。早く売る前提なので、最安で売ったときの利益で見せる（過大表示を防ぐ正直版）。
      // 中央値(realMedianPrice)は併記用に保持。外れ値(別物/破損/まとめ売り)は trimmedMedianJpy で除外済み。
      let realAvgPrice = ebayItem.priceJpy, realMedianPrice = ebayItem.priceJpy, realCount = 1, finalProfit = profit, finalRate = profitRate;
      const med = await marketMedianPriceJpy(searchQueryFor(coreKeyword));
      if (med && med.count >= 5) {
        const low = med.low ?? med.median;                 // ロバストな最安（旧キャッシュ対策で中央値フォールバック）
        realAvgPrice = Math.min(ebayItem.priceJpy, low);   // ★相場＝eBay最安値ベース
        realMedianPrice = med.median;
        realCount = med.count;
        const r = calcProfit(rakutenItem.itemPrice, realAvgPrice, pointAmount, shipJpy);
        finalProfit = r.profit; finalRate = r.profitRate;
        if (finalRate <= PROFIT_RATE_FLOOR || finalRate > 300) continue; // 利益率10%以下/異常高は除外
      }

      return {
        type: 'profit',
        id: itemId,
        rakutenId: rakutenItem.itemCode,
        product: {
          id: rakutenItem.itemCode,
          title: rakutenItem.itemName,
          imageUrl: rakutenImg,
          category: cat,
          source: {
            site: 'rakuten',
            siteName: '楽天',
            price: rakutenItem.itemPrice,
            url: rakutenItem.affiliateUrl || rakutenItem.itemUrl,
            pointRate,
            pointAmount,
            shippingJpy: shipJpy,                               // 利益計算に算入済みの国内送料概算
            postageIncluded: Number(rakutenItem.postageFlag) === 0,
          },
          isNew: rakutenItem.itemName.includes('新品') || rakutenItem.itemName.includes('未開封'),
          market: 'EBAY_US',
          coreKeyword,
          ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(coreKeyword)}&LH_Complete=1&LH_Sold=1`,
          realAvgPrice,         // ★eBay最安値ベース（表示・利益の基準）
          realMedianPrice,      // 中央値（併記用・参考）
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
    haikuFail: haikuFailToday,
    sonnetCalls: sonnetCallsToday,
    elapsedMin: Math.round((Date.now() - startedAt) / 60000),
    runAt: new Date().toISOString(),
  }, 480 * 3600);
  // 観測フック: 照合(Anthropic)の健康状態を専用キーにも残す（/api やレポートから参照しやすく）。
  await kvSet('match_health', {
    haiku: haikuCallsToday, sonnet: sonnetCallsToday, haikuFail: haikuFailToday,
    down: haikuFailToday > 0 && haikuCallsToday === 0,
    runAt: new Date().toISOString(),
  }, 480 * 3600);

  // 観測フック: Haikuが全滅(成功0/失敗あり)＝Anthropic到達不可。未検証のまま商品が通る(fail-open)危険状態なのでCIログで目立たせる。
  if (haikuFailToday > 0 && haikuCallsToday === 0) {
    console.log(`
⚠️⚠️ 照合DOWN: Haiku成功0 / 失敗${haikuFailToday}回 → Anthropic到達不可。未検証のまま商品が通る(fail-open)状態。
   → ANTHROPIC_API_KEY / クレジット残高 / レート制限を確認してください。`);
  } else if (haikuFailToday > 0) {
    console.log(`  ⚠️ 照合の一部でHaiku不通: 失敗${haikuFailToday}回（その分は保留=fail-open）`);
  }

  console.log(`
✨ 完了!
  eBay売れ済み: ${ebayJpItems.length}件
  処理: ${toProcess.length}件
  新規利益商品: ${profitableProducts.length - existingProducts.length}件
  DB合計: ${profitableProducts.length}件（480時間TTL）
  画像判定(Claude): Haiku 成功${haikuCallsToday}/不通${haikuFailToday}回 / Sonnet確認 ${sonnetCallsToday}回
  所要時間: ${Math.round((Date.now() - startedAt) / 60000)}分
`);
}

main().catch(e => { console.error(e); process.exit(1); });
