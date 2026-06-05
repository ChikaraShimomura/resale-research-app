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

// ========== eBay落札済み価格スクレイピング ==========
async function getEbaySoldPrices(keyword: string): Promise<number[]> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1&_ipg=60`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const prices: number[] = [];

    // eBayのHTMLから落札価格を抽出
    // パターン1: s-item__price スパン
    const priceRegex = /class="s-item__price"[^>]*>\s*(?:US )?\$?([\d,]+\.?\d*)/g;
    let m;
    while ((m = priceRegex.exec(html)) !== null) {
      const usd = parseFloat(m[1].replace(/,/g, ""));
      if (usd > 0) prices.push(Math.round(usd * USD_TO_JPY));
    }

    // パターン2: SOLD価格のJSON-LD
    if (prices.length === 0) {
      const jsonMatches = html.match(/"price"\s*:\s*"?([\d.]+)"?/g) ?? [];
      for (const jm of jsonMatches) {
        const numMatch = jm.match(/([\d.]+)/);
        if (numMatch) {
          const usd = parseFloat(numMatch[1]);
          if (usd > 1 && usd < 10000) prices.push(Math.round(usd * USD_TO_JPY));
        }
      }
    }

    return prices;
  } catch {
    return [];
  }
}

// ========== 型番・商品コード抽出 ==========
function extractProductCode(title: string): string[] {
  const patterns = [
    /[A-Z]{2,}-?\d{3,}/g,
    /\b[A-Z]\d{4,}[A-Z]?\b/g,
    /\b\d{4}-\d{4}\b/g,
    /(?:第\d+弾|Vol\.\d+|BOX\d*)/g,
    /\b\d{4,5}\b/g,
  ];
  const codes: string[] = [];
  for (const p of patterns) codes.push(...(title.match(p) ?? []));
  return [...new Set(codes)];
}

// ========== メインAPIハンドラー ==========
export async function POST(req: NextRequest) {
  const { rakutenTitle, rakutenPrice } = await req.json();

  if (!rakutenTitle) return Response.json({ matched: false, avgPrice: null, count: 0 });

  const cacheKey = `ebay_${rakutenTitle.slice(0, 40)}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json({ ...cached, fromCache: true });

  // クリーンなタイトル生成
  const cleanTitle = rakutenTitle
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/送料無料|新品|未開封|未使用|正規品|セール|互換|風/g, "")
    .replace(/\s+/g, " ").trim();

  const codes = extractProductCode(cleanTitle);
  const words = cleanTitle.split(/\s+/).filter((w: string) => w.length >= 2);

  // 製品番号優先のキーワード（最大4語）
  const keyParts: string[] = [];
  if (codes[0]) keyParts.push(codes[0]);
  for (const w of words) {
    if (keyParts.length >= 4) break;
    if (w === codes[0]) continue;
    keyParts.push(w);
  }
  const searchKeyword = keyParts.join(" ");

  // eBay落札済み価格取得
  let prices = await getEbaySoldPrices(searchKeyword);

  // リトライ（短縮キーワード）
  if (prices.length === 0 && keyParts.length > 2) {
    prices = await getEbaySoldPrices(keyParts.slice(0, 2).join(" "));
  }

  if (prices.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // 価格フィルター（仕入れ価格の50%〜500%）
  const filtered = prices.filter(
    (p) => p >= rakutenPrice * 0.5 && p <= rakutenPrice * 5
  );

  if (filtered.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // 外れ値除去して平均計算
  const sorted = [...filtered].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const valid = sorted.filter((p) => p >= median * 0.5 && p <= median * 2);
  const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);

  const result = { matched: true, avgPrice, count: valid.length };
  setCache(cacheKey, result);
  return Response.json(result);
}
