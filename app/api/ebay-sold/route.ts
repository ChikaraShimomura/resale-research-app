import { NextRequest } from "next/server";

// キャッシュ（2時間TTL）
const cache = new Map<string, { avgPrice: number; count: number; expiresAt: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry;
}
function setCache(key: string, data: { avgPrice: number; count: number }) {
  if (cache.size >= 500) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  cache.set(key, { ...data, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
}

// JPY換算（固定レート、後でAPIに変えられる）
const USD_TO_JPY = 155;

function parseUsdPrice(text: string): number | null {
  const m = text.match(/\$[\s]?([\d,]+\.?\d*)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * USD_TO_JPY);
}

async function fetchEbaySoldPrices(keyword: string): Promise<{ avgPrice: number; count: number } | null> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1&_ipg=60&LH_ItemCondition=3`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    // 落札価格を抽出（eBayのHTML構造から）
    const prices: number[] = [];

    // パターン1: s-item__price クラス周辺の価格
    const priceMatches = html.matchAll(/class="[^"]*s-item__price[^"]*"[^>]*>[\s\S]*?(\$[\d,]+\.?\d*)/g);
    for (const m of priceMatches) {
      const p = parseUsdPrice(m[1]);
      if (p && p > 0) prices.push(p);
    }

    // パターン2: lblとして表示される価格
    if (prices.length === 0) {
      const matches = html.match(/\$\s*[\d,]+\.\d{2}/g) ?? [];
      for (const m of matches) {
        const p = parseUsdPrice(m);
        if (p && p > 500 && p < 500000) prices.push(p); // 合理的な範囲のみ
      }
    }

    if (prices.length === 0) return null;

    // 外れ値除去（中央値の30%〜300%）
    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const valid = prices.filter((p) => p >= median * 0.3 && p <= median * 3);
    if (valid.length === 0) return null;

    const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    return { avgPrice, count: valid.length };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword") ?? "";
  if (!keyword) return Response.json({ avgPrice: null, count: 0 });

  const cacheKey = `ebay_${keyword.slice(0, 50)}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json({ ...cached, fromCache: true });

  const result = await fetchEbaySoldPrices(keyword);
  if (!result) return Response.json({ avgPrice: null, count: 0 });

  setCache(cacheKey, result);
  return Response.json(result);
}
