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

let lastDebug = "";

async function fetchEbaySoldPrices(keyword: string): Promise<{ avgPrice: number; count: number } | null> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1&_ipg=60`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(10000),
    });

    lastDebug = `status:${res.status}`;
    if (!res.ok) return null;
    const html = await res.text();
    lastDebug += ` htmlLen:${html.length}`;

    const prices: number[] = [];

    // パターン1: s-item__price span内の価格テキスト
    const spanMatches = html.match(/<span class="[^"]*s-item__price[^"]*">([\s\S]*?)<\/span>/g) ?? [];
    lastDebug += ` spanMatches:${spanMatches.length}`;
    for (const span of spanMatches) {
      const text = span.replace(/<[^>]+>/g, "");
      const p = parseUsdPrice(text);
      if (p && p > 300 && p < 2000000) prices.push(p);
    }

    // パターン2: data-price属性
    if (prices.length === 0) {
      const dataMatches = html.match(/data-price="([\d.]+)"/g) ?? [];
      lastDebug += ` dataMatches:${dataMatches.length}`;
      for (const m of dataMatches) {
        const val = parseFloat(m.replace(/[^0-9.]/g, ""));
        if (val > 0) prices.push(Math.round(val * USD_TO_JPY));
      }
    }

    // パターン3: 全$価格
    if (prices.length === 0) {
      const allPrices = html.match(/\$\s*[\d,]+\.\d{2}/g) ?? [];
      lastDebug += ` allPrices:${allPrices.length}`;
      for (const m of allPrices) {
        const p = parseUsdPrice(m);
        if (p && p > 300 && p < 2000000) prices.push(p);
      }
    }

    lastDebug += ` prices:${prices.length}`;
    if (prices.length === 0) return null;

    // 外れ値除去（中央値の30%〜300%）
    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const valid = prices.filter((p) => p >= median * 0.3 && p <= median * 3);
    if (valid.length === 0) return null;

    const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    return { avgPrice, count: valid.length };
  } catch (e) {
    lastDebug = `exception:${e}`;
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
  if (!result) return Response.json({ avgPrice: null, count: 0, debug: lastDebug });

  setCache(cacheKey, result);
  return Response.json({ ...result, debug: lastDebug });
}
