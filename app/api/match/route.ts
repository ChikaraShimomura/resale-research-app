import { NextRequest } from "next/server";

// ========== キャッシュ（6時間TTL） ==========
const cache = new Map<string, { avgPrice: number | null; count: number; matched: boolean; expiresAt: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry;
}
function setCache(key: string, data: { avgPrice: number | null; count: number; matched: boolean }) {
  if (cache.size >= 1000) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  cache.set(key, { ...data, expiresAt: Date.now() + CACHE_TTL });
}

const USD_TO_JPY = 155;

// ========== 日本語ブランド名 → 英語辞書 ==========
const BRAND_JP_TO_EN: Record<string, string> = {
  // ゲーム・電子機器
  "任天堂": "Nintendo", "ニンテンドー": "Nintendo",
  "ソニー": "Sony", "プレイステーション": "PlayStation",
  "セガ": "Sega", "カプコン": "Capcom", "コナミ": "Konami",
  "バンダイ": "Bandai", "バンダイナムコ": "Bandai Namco",
  "スクウェアエニックス": "Square Enix", "スクエニ": "Square Enix",
  "任天堂スイッチ": "Nintendo Switch",
  // おもちゃ・ホビー
  "レゴ": "LEGO", "タカラトミー": "Takara Tomy", "トミカ": "Tomica",
  "ハスブロ": "Hasbro", "マテル": "Mattel",
  "コトブキヤ": "Kotobukiya", "グッドスマイル": "Good Smile",
  "マックスファクトリー": "Max Factory", "アルター": "Alter",
  "メガハウス": "MegaHouse", "フリーイング": "FREEing",
  // カード
  "ポケモン": "Pokemon", "ポケットモンスター": "Pokemon",
  "遊戯王": "Yu-Gi-Oh", "デュエルマスターズ": "Duel Masters",
  "ワンピース": "One Piece",
  // アニメ・マンガキャラ
  "ドラゴンボール": "Dragon Ball", "ナルト": "Naruto",
  "進撃の巨人": "Attack on Titan", "鬼滅の刃": "Demon Slayer",
  "呪術廻戦": "Jujutsu Kaisen",
  "エヴァンゲリオン": "Evangelion", "ガンダム": "Gundam",
  "マクロス": "Macross", "ゴジラ": "Godzilla",
  // カメラ・光学
  "キヤノン": "Canon", "キャノン": "Canon",
  "ニコン": "Nikon", "フジフイルム": "Fujifilm", "フジフィルム": "Fujifilm",
  "オリンパス": "Olympus", "パナソニック": "Panasonic",
  // その他
  "アップル": "Apple", "マイクロソフト": "Microsoft",
  "シャープ": "Sharp", "東芝": "Toshiba", "富士通": "Fujitsu",
};

// ========== カタカナ → ローマ字（よく出る商品名用） ==========
const KATAKANA_TO_ROMAJI: Record<string, string> = {
  "ポケモン": "Pokemon", "ピカチュウ": "Pikachu",
  "ガンダム": "Gundam", "ザク": "Zaku",
  "ドラゴン": "Dragon", "ナルト": "Naruto",
  "ルフィ": "Luffy", "ゾロ": "Zoro",
  "エヴァ": "Eva", "エヴァンゲリオン": "Evangelion",
  "ゴジラ": "Godzilla", "ウルトラマン": "Ultraman",
  "リカちゃん": "Licca", "バービー": "Barbie",
  "トランスフォーマー": "Transformers",
  "スターウォーズ": "Star Wars",
  "マリオ": "Mario", "ルイージ": "Luigi", "リンク": "Link",
  "ピクミン": "Pikmin", "カービィ": "Kirby",
  "ソニック": "Sonic", "テイルス": "Tails",
  "ミク": "Miku", "ミクダヨー": "Miku",
  "初音ミク": "Hatsune Miku",
  "ワンダーウーマン": "Wonder Woman",
  "スパイダーマン": "Spider-Man",
  "アイアンマン": "Iron Man",
  "キャプテンアメリカ": "Captain America",
};

// ========== ノイズ除去パターン ==========
const NOISE_PATTERN = new RegExp([
  "送料無料", "新品", "未開封", "未使用", "正規品", "国内正規", "日本正規",
  "プレゼント", "ギフト", "ラッピング", "数量限定", "限定",
  "特価", "お得", "即日", "翌日", "あす楽", "ポイント\\d+倍?", "ポイントアップ",
  "在庫あり", "即納", "在庫限り", "残りわずか", "セール", "値下げ",
  "楽天ランキング", "ランキング\\d+位", "\\d+個セット",
  "送料込", "税込", "税抜", "定価", "希望小売価格",
  "代引不可", "代引き不可", "後払い不可",
].join("|"), "g");

function cleanTitle(title: string): string {
  return title
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/『[^』]*』/g, "")
    .replace(/≪[^≫]*≫/g, "")
    .replace(/＜[^＞]*＞/g, "")
    .replace(NOISE_PATTERN, "")
    .replace(/[★☆◆◇●○■□▲△▼▽♪♥♡※〇！？｜・×÷＊→←↑↓◎]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 全角→半角 + 英字大文字統一
function normalizeText(text: string): string {
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, " ")
    .toUpperCase();
}

// ========== 日本語ブランド→英語変換 ==========
function translateBrands(title: string): string {
  let result = title;
  for (const [jp, en] of Object.entries(BRAND_JP_TO_EN)) {
    result = result.replace(new RegExp(jp, "g"), en);
  }
  for (const [kana, romaji] of Object.entries(KATAKANA_TO_ROMAJI)) {
    result = result.replace(new RegExp(kana, "g"), romaji);
  }
  return result;
}

// ========== 製品コード抽出（最優先識別子） ==========
function extractProductCodes(title: string): string[] {
  const norm = normalizeText(title);
  const codes: string[] = [];

  // LEGO セット番号（4〜5桁の数字: 1000-99999）
  const lego = norm.match(/\b([1-9]\d{3,4})\b/g) ?? [];
  codes.push(...lego.filter(n => parseInt(n) >= 1000));

  // ガンプラスケール（1/100, 1/144 など）
  const scale = norm.match(/1\/\d{2,3}/g) ?? [];
  codes.push(...scale);

  // ガンプラグレード（MG, RG, HG, PG, RE, SD, EG）
  const grade = norm.match(/\b(?:MG|RG|HG|PG|RE\/100|RE|SD|EG|NG|HGUC|HGCE|HGIBO|MG|RG|PG)\b/g) ?? [];
  codes.push(...grade);

  // Ver.xxx（バージョン表記）
  const ver = norm.match(/VER\.?[A-Z0-9.]+/g) ?? [];
  codes.push(...ver);

  // ポケモンカード拡張セットコード（SV5M, SV4a, S12, BW など）
  const pokeSet = norm.match(/\b(?:SV|S|SM|XY|BW|DP|EX|GX|VMAX|VSTAR|ACE|AR)[0-9]{0,2}[A-Z]?\b/g) ?? [];
  codes.push(...pokeSet.filter(c => c.length >= 2 && !["EX", "GX"].includes(c)));

  // 遊戯王カードコード（DB21-JP, SD40-JP など）
  const ygo = norm.match(/\b[A-Z]{2,5}-[A-Z]{2,3}[0-9]{3,4}\b/g) ?? [];
  codes.push(...ygo);

  // アルファベット+数字の型番（PS5, RX-78, GN-001 など）
  const alphaNum = norm.match(/\b[A-Z]{1,4}[-\s]?[0-9]{2,4}[A-Z]?\b/g) ?? [];
  codes.push(...alphaNum.filter(c => c.length >= 3 && !["DVD", "CD", "TV", "BOX"].includes(c)));

  // 5桁以上の数字（商品番号・JANコード系）
  const longNum = norm.match(/\b\d{5,8}\b/g) ?? [];
  codes.push(...longNum);

  return [...new Set(codes)].filter(c => c.length >= 2);
}

// ========== ブランド名・英字語抽出 ==========
function extractLatinTerms(title: string): string[] {
  const translated = translateBrands(title);
  const words = translated.match(/[A-Za-z][A-Za-z0-9.&'\-]{1,}/g) ?? [];
  const stopWords = new Set([
    "the", "and", "for", "new", "ver", "vol", "box", "dvd", "cd", "no", "of",
    "in", "with", "set", "limited", "edition", "special", "japan", "japanese",
    "import", "used", "item", "product", "figure", "model", "kit",
  ]);
  return [...new Set(words.filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase())))];
}

// ========== キーワード重要度スコアリング ==========
// タイトル内の各語に重みを付ける
interface ScoredTerm {
  term: string;
  weight: number;
  isCode: boolean;
}

function scoreTerms(title: string): ScoredTerm[] {
  const clean = cleanTitle(title);
  const norm = normalizeText(clean);
  const translated = translateBrands(clean);
  const codes = extractProductCodes(norm);
  const latin = extractLatinTerms(translated);

  const result: ScoredTerm[] = [];

  // 製品コードは最高重み
  for (const code of codes) {
    result.push({ term: code, weight: 10, isCode: true });
  }

  // ラテン文字語は中〜高重み（長いほど重要）
  for (const l of latin) {
    if (codes.some(c => c.toUpperCase() === l.toUpperCase())) continue;
    const weight = l.length >= 6 ? 4 : l.length >= 4 ? 3 : 2;
    result.push({ term: l, weight, isCode: false });
  }

  return result;
}

// ========== eBay検索クエリ構築 ==========
function buildEbayQueries(title: string): string[] {
  const clean = cleanTitle(title);
  const norm = normalizeText(clean);
  const translated = translateBrands(clean);
  const codes = extractProductCodes(norm);
  const latin = extractLatinTerms(translated);

  const queries: string[] = [];

  // クエリ1: 製品コードが最重要（あれば絞り込みに最適）
  if (codes.length > 0) {
    const codeQuery = codes.slice(0, 2).join(" ");
    const brandTerms = latin.slice(0, 2).join(" ");
    queries.push([codeQuery, brandTerms].filter(Boolean).join(" ").trim());
  }

  // クエリ2: ブランド名+型番のみ（コードが失敗した場合のリトライ用）
  if (latin.length >= 2) {
    queries.push(latin.slice(0, 5).join(" "));
  }

  // クエリ3: コードのみ（最も精度高いが件数少ない可能性あり）
  if (codes.length >= 1) {
    queries.push(codes.slice(0, 3).join(" "));
  }

  // クエリ4: フォールバック（翻訳済みタイトルの上位語）
  if (queries.length === 0 || latin.length === 0) {
    const words = translated.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w) && w.length >= 2);
    queries.push(words.slice(0, 5).join(" "));
  }

  return [...new Set(queries)].filter(q => q.length > 0);
}

// ========== eBay落札済み商品取得 ==========
interface EbayItem {
  title: string;
  price: number;
}

async function getEbaySoldItems(query: string, limit = 60): Promise<EbayItem[]> {
  if (!query.trim()) return [];
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Complete=1&LH_Sold=1&_ipg=${limit}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const items: EbayItem[] = [];
    const itemBlocks = html.match(/<li class="s-item[^"]*"[\s\S]*?<\/li>/g) ?? [];

    for (const block of itemBlocks) {
      // タイトル
      const titleMatch = block.match(/class="s-item__title"[^>]*>([\s\S]*?)<\/[^>]+>/);
      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      if (title.includes("Shop on eBay") || !title) continue;

      // 価格（範囲表記 "$10.00 to $20.00" の場合は平均を取る）
      const priceRange = block.match(/\$([\d,]+\.?\d*)\s*to\s*\$([\d,]+\.?\d*)/);
      if (priceRange) {
        const low = parseFloat(priceRange[1].replace(/,/g, ""));
        const high = parseFloat(priceRange[2].replace(/,/g, ""));
        items.push({ title, price: Math.round(((low + high) / 2) * USD_TO_JPY) });
        continue;
      }

      const priceMatch = block.match(/class="s-item__price"[^>]*>[\s\S]*?\$([\d,]+\.?\d*)/);
      const usd = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0;
      if (usd > 0) items.push({ title, price: Math.round(usd * USD_TO_JPY) });
    }

    // フォールバック
    if (items.length === 0) {
      const priceRegex = /class="s-item__price"[^>]*>\s*(?:US )?\$?([\d,]+\.?\d*)/g;
      let m;
      while ((m = priceRegex.exec(html)) !== null) {
        const usd = parseFloat(m[1].replace(/,/g, ""));
        if (usd > 0) items.push({ title: "", price: Math.round(usd * USD_TO_JPY) });
      }
    }

    return items;
  } catch {
    return [];
  }
}

// ========== 商品マッチスコアリング ==========
// 0〜100のスコアを返す。60以上でマッチとみなす
function calcMatchScore(
  ebayItem: EbayItem,
  scoredTerms: ScoredTerm[],
  rakutenPrice: number
): number {
  // 価格フィルター（40%〜600%）
  if (ebayItem.price < rakutenPrice * 0.4 || ebayItem.price > rakutenPrice * 6) return 0;

  // タイトルなし（フォールバック取得）→価格フィルターのみ通過、スコア50
  if (!ebayItem.title) return 50;

  const ebayNorm = normalizeText(ebayItem.title);

  // バンドル・ロット除外（楽天単品との比較不正確になる）
  if (/\b(LOT|BUNDLE|WHOLESALE|BULK|JOBLOT|JOB LOT|\d+\s*PIECES|\d+\s*PCS)\b/.test(ebayNorm)) {
    return 0;
  }

  // コードマッチ（必須チェック）
  const codedTerms = scoredTerms.filter(t => t.isCode);
  const nonCodeTerms = scoredTerms.filter(t => !t.isCode);

  let score = 0;
  let maxScore = 0;

  if (codedTerms.length > 0) {
    // 製品コードが存在する場合：最低1つは必ずマッチしないとスコア0
    const matchedCodes = codedTerms.filter(t => {
      const normalized = normalizeText(t.term);
      return ebayNorm.includes(normalized);
    });

    if (matchedCodes.length === 0) return 0; // コードが1つもマッチしない→別商品

    // コードのスコア加算
    for (const t of codedTerms) {
      maxScore += t.weight;
      if (ebayNorm.includes(normalizeText(t.term))) score += t.weight;
    }
  }

  // 非コード語のスコア加算（ブランド名・シリーズ名）
  for (const t of nonCodeTerms) {
    maxScore += t.weight;
    if (ebayNorm.includes(normalizeText(t.term))) score += t.weight;
  }

  if (maxScore === 0) return 55; // 判定材料なし → デフォルト

  const ratio = score / maxScore;

  // スコア計算: コードありは厳格、なしは緩め
  if (codedTerms.length > 0) {
    // コードマッチ必須 + 非コード語マッチで加点
    return Math.round(60 + ratio * 40);
  } else {
    // コードなし: 非コード語のみ → 50%以上マッチで通過
    if (ratio >= 0.5) return Math.round(50 + ratio * 50);
    return Math.round(ratio * 50);
  }
}

// ========== IQRベース外れ値除去 + 平均計算 ==========
function calcRobustAverage(prices: number[]): { avg: number; count: number } {
  if (prices.length === 0) return { avg: 0, count: 0 };
  if (prices.length <= 2) {
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    return { avg, count: prices.length };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  // IQR方式: Q1 - 1.5×IQR 〜 Q3 + 1.5×IQR の範囲内のみ
  const lower = q1 - iqr * 1.5;
  const upper = q3 + iqr * 1.5;
  const filtered = sorted.filter(p => p >= lower && p <= upper);

  // さらに中央値から50%〜200%に絞る（二重フィルタ）
  const median = filtered[Math.floor(filtered.length / 2)];
  const final = filtered.filter(p => p >= median * 0.5 && p <= median * 2.0);

  if (final.length === 0) return { avg: 0, count: 0 };
  const avg = Math.round(final.reduce((a, b) => a + b, 0) / final.length);
  return { avg, count: final.length };
}

// ========== メインAPIハンドラー ==========
export async function POST(req: NextRequest) {
  const { rakutenTitle, rakutenPrice } = await req.json();
  if (!rakutenTitle || !rakutenPrice) return Response.json({ matched: false, avgPrice: null, count: 0 });

  const cacheKey = `ebay_v3_${rakutenTitle.slice(0, 60)}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json({ ...cached, fromCache: true });

  const clean = cleanTitle(rakutenTitle);
  const scoredTerms = scoreTerms(clean);
  const queries = buildEbayQueries(clean);

  if (queries.length === 0 || queries[0].length < 3) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // マルチクエリ戦略: 最初のクエリで十分な結果が得られれば終了、なければ次のクエリへ
  let allItems: EbayItem[] = [];

  for (const query of queries.slice(0, 3)) {
    const items = await getEbaySoldItems(query);
    allItems = [...allItems, ...items];

    // 重複除去（同一価格・同一タイトル）
    const seen = new Set<string>();
    allItems = allItems.filter(item => {
      const key = `${item.title}|${item.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // スコアリングして有効アイテムを確認
    const validSoFar = allItems.filter(item => calcMatchScore(item, scoredTerms, rakutenPrice) >= 60);

    // 有効アイテムが5件以上あれば十分
    if (validSoFar.length >= 5) break;
  }

  if (allItems.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // スコアリング: 60点以上をマッチとみなす
  const validItems = allItems.filter(item => calcMatchScore(item, scoredTerms, rakutenPrice) >= 60);

  if (validItems.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // IQRベース外れ値除去
  const prices = validItems.map(i => i.price);
  const { avg: avgPrice, count } = calcRobustAverage(prices);

  if (avgPrice === 0 || count === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  const result = { matched: true, avgPrice, count };
  setCache(cacheKey, result);
  return Response.json(result);
}
