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

// ========== ノイズ除去 ==========
const NOISE_PATTERN = new RegExp([
  "送料無料", "新品", "未開封", "未使用", "正規品", "国内正規",
  "プレゼント", "ギフト", "ラッピング", "数量限定", "限定",
  "特価", "お得", "即日", "翌日", "あす楽", "ポイント\\d+倍?",
  "在庫あり", "即納", "在庫限り", "残りわずか", "セール",
  "楽天ランキング", "ランキング\\d+位", "\\d+個セット",
].join("|"), "g");

function cleanTitle(title: string): string {
  return title
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/『[^』]*』/g, "")
    .replace(NOISE_PATTERN, "")
    .replace(/[★☆◆◇●○■□▲△▼▽♪♥♡※〇！？｜・×÷]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ========== 製品コード抽出（最優先識別子） ==========
function extractProductCodes(title: string): string[] {
  const codes: string[] = [];

  // LEGO セット番号（4〜5桁の数字）
  const lego = title.match(/\b([4-9]\d{4}|[1-9]\d{3})\b/g) ?? [];
  codes.push(...lego);

  // ガンプラ・プラモデルスケール（1/100, 1/144 など）
  const scale = title.match(/1\/\d{2,3}/g) ?? [];
  codes.push(...scale);

  // モデルコード（英字+数字 例：RX-78, MG, RG, HG, PG, Ver.Ka）
  const model = title.match(/\b(?:MG|RG|HG|PG|RE|SD|EG|NG)(?:\s+1\/\d+)?\b/g) ?? [];
  codes.push(...model);

  // Ver.xxx（バージョン表記）
  const ver = title.match(/Ver\.[A-Za-z0-9.]+/g) ?? [];
  codes.push(...ver);

  // ポケモンカード拡張セットコード（2-4英字+数字 例：SV5M, SV4a, S12）
  const poke = title.match(/\b[A-Z]{1,3}\d{1,2}[a-zA-Z]?\b/g) ?? [];
  codes.push(...poke.filter(c => !["MG", "RG", "HG", "PG", "SD", "EG", "NG", "RE", "BOX", "CD", "DVD", "TV"].includes(c)));

  // アルファベット+数字の型番 (PS5, Switch, RTX3080 など)
  const alphaNum = title.match(/\b[A-Z]{1,4}[\s-]?\d{2,4}[A-Za-z]?\b/g) ?? [];
  codes.push(...alphaNum.filter(c => c.length >= 3));

  // 5桁以上の数字（商品番号）
  const longNum = title.match(/\b\d{5,8}\b/g) ?? [];
  codes.push(...longNum);

  return [...new Set(codes)].filter(c => c.length >= 2);
}

// ========== ブランド名・英字語抽出 ==========
function extractLatinTerms(title: string): string[] {
  // 2文字以上の連続した英字語（ブランド名、シリーズ名など）
  const words = title.match(/[A-Za-z][A-Za-z0-9.&''-]{1,}/g) ?? [];
  const stopWords = new Set(["the", "and", "for", "new", "ver", "vol", "box", "dvd", "cd", "no", "of", "in", "with", "set"]);
  return words.filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase()));
}

// ========== カタカナ語抽出（商品名に多い） ==========
function extractKatakana(title: string): string[] {
  const words = title.match(/[ァ-ヶーヲ]{3,}/g) ?? [];
  // 一般的すぎる語を除外
  const skip = new Set(["プレゼント", "ギフト", "ランキング", "ポイント", "セール", "ショッピング", "ストア"]);
  return words.filter(w => !skip.has(w)).slice(0, 3);
}

// ========== eBay検索クエリを構築 ==========
function buildEbayQuery(title: string): { query: string; mustCodes: string[] } {
  const clean = cleanTitle(title);
  const codes = extractProductCodes(clean);
  const latin = extractLatinTerms(clean);
  const katakana = extractKatakana(clean);

  const parts: string[] = [];

  // 製品コードが最重要（あればそれだけで十分なことが多い）
  parts.push(...codes.slice(0, 3));

  // ラテン文字ブランド名・シリーズ名
  const latinUnique = latin.filter(l => !codes.some(c => c.toLowerCase() === l.toLowerCase()));
  parts.push(...latinUnique.slice(0, 3));

  // 製品コードがない場合はカタカナ語をローマ字近似で追加
  if (codes.length === 0 && katakana.length > 0) {
    parts.push(...katakana.slice(0, 2));
  }

  // 最低3語は確保（少なすぎると全然関係ない商品がヒットする）
  if (parts.length < 2) {
    const words = clean.split(/\s+/).filter(w => w.length >= 2);
    parts.push(...words.slice(0, 4));
  }

  const query = [...new Set(parts)].slice(0, 6).join(" ");
  // 製品コードの中で最も特定性が高いもの（5桁以上の数字や型番）を必須チェック対象に
  const mustCodes = codes.filter(c => /\d{4,}|Ver\.|1\/\d+/.test(c)).slice(0, 2);

  return { query, mustCodes };
}

// ========== eBay落札済み価格取得（バリデーション付き） ==========
interface EbayItem {
  title: string;
  price: number;
}

async function getEbaySoldItems(query: string): Promise<EbayItem[]> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Complete=1&LH_Sold=1&_ipg=60`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const items: EbayItem[] = [];

    // タイトルと価格を同時に抽出
    // eBayのHTMLパターン: s-item__title と s-item__price が対応
    const itemBlocks = html.match(/<li class="s-item[^"]*"[\s\S]*?<\/li>/g) ?? [];

    for (const block of itemBlocks) {
      // タイトル抽出
      const titleMatch = block.match(/class="s-item__title"[^>]*>([\s\S]*?)<\/[^>]+>/);
      const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";

      // 価格抽出
      const priceMatch = block.match(/class="s-item__price"[^>]*>[\s\S]*?\$([\d,]+\.?\d*)/);
      const usd = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : 0;

      if (title && usd > 0 && !title.includes("Shop on eBay")) {
        items.push({ title, price: Math.round(usd * USD_TO_JPY) });
      }
    }

    // パターン1が取れなかった場合のフォールバック：価格のみ
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

// ========== 商品マッチバリデーション ==========
function validateMatch(
  ebayItem: EbayItem,
  mustCodes: string[],
  latinTerms: string[],
  rakutenPrice: number
): boolean {
  const ebayTitle = ebayItem.title.toLowerCase();

  // 価格フィルター（仕入れ価格の40%〜600%）
  if (ebayItem.price < rakutenPrice * 0.4 || ebayItem.price > rakutenPrice * 6) return false;

  // タイトルなし（フォールバックで取得した場合）は価格フィルターのみ
  if (!ebayItem.title) return true;

  // 製品コードが指定されている場合：1つでも一致すればOK
  if (mustCodes.length > 0) {
    const hasCode = mustCodes.some(code =>
      ebayTitle.includes(code.toLowerCase())
    );
    if (hasCode) return true;
    // 製品コードが1つもマッチしない場合は除外（別商品の可能性が高い）
    return false;
  }

  // 製品コードなし：ラテン語の50%以上がマッチ
  if (latinTerms.length >= 2) {
    const matchCount = latinTerms.filter(t => ebayTitle.includes(t.toLowerCase())).length;
    return matchCount >= Math.ceil(latinTerms.length * 0.5);
  }

  // それ以外：価格フィルターのみで判断
  return true;
}

// ========== メインAPIハンドラー ==========
export async function POST(req: NextRequest) {
  const { rakutenTitle, rakutenPrice } = await req.json();
  if (!rakutenTitle || !rakutenPrice) return Response.json({ matched: false, avgPrice: null, count: 0 });

  const cacheKey = `ebay_v2_${rakutenTitle.slice(0, 50)}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json({ ...cached, fromCache: true });

  const clean = cleanTitle(rakutenTitle);
  const { query, mustCodes } = buildEbayQuery(clean);
  const latinTerms = extractLatinTerms(clean);

  // eBay検索（メインクエリ）
  let items = await getEbaySoldItems(query);

  // 結果が少ない場合：クエリを短縮してリトライ
  if (items.length < 3 && query.includes(" ")) {
    const shorterQuery = query.split(" ").slice(0, 3).join(" ");
    const moreItems = await getEbaySoldItems(shorterQuery);
    items = [...items, ...moreItems];
  }

  if (items.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // バリデーション：同一商品かチェック
  const validItems = items.filter(item =>
    validateMatch(item, mustCodes, latinTerms, rakutenPrice)
  );

  if (validItems.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // 外れ値除去して平均計算
  const prices = validItems.map(i => i.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const valid = prices.filter(p => p >= median * 0.5 && p <= median * 2);
  const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);

  const result = { matched: true, avgPrice, count: valid.length };
  setCache(cacheKey, result);
  return Response.json(result);
}
