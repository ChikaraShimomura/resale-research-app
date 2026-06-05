import { NextRequest } from "next/server";

// ========== キャッシュ（2時間TTL） ==========
const cache = new Map<string, { data: MercariResult; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2時間

interface MercariResult {
  avgPrice: number | null;
  count: number;
  minPrice?: number;
  maxPrice?: number;
}

function getCached(key: string): MercariResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: MercariResult) {
  // キャッシュが大きくなりすぎないよう上限500件
  if (cache.size >= 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ========== User-Agentローテーション ==========
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ========== ランダム遅延（100〜400ms） ==========
function randomDelay(): Promise<void> {
  const ms = 100 + Math.random() * 300;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========== 同時リクエスト制限 ==========
let activeRequests = 0;
const MAX_CONCURRENT = 3;

// ========== メルカリ検索 ==========
async function searchMercariSold(keyword: string): Promise<MercariResult> {
  const ua = randomUA();

  const body = {
    pageSize: 30,
    pageToken: "",
    searchSessionId: Math.random().toString(36).slice(2) + Date.now().toString(36),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED",
    thumbnailTypes: [],
    searchCondition: {
      keyword,
      excludeKeyword: "",
      sort: "SORT_CREATED_TIME",
      order: "ORDER_DESC",
      status: ["STATUS_SOLD_OUT"],
      sizeId: [],
      categoryId: [],
      brandId: [],
      sellerId: [],
      priceMin: 0,
      priceMax: 0,
      itemConditionId: [],
      shippingPayerId: [],
      shippingFromArea: [],
      shippingMethod: [],
      colorId: [],
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
    },
    userId: "",
  };

  const res = await fetch("https://api.mercari.jp/v2/entities:search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": ua,
      "Origin": "https://jp.mercari.com",
      "Referer": "https://jp.mercari.com/search?keyword=" + encodeURIComponent(keyword) + "&status=sold_out",
      "X-Platform": "web",
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return { avgPrice: null, count: 0 };

  const data = await res.json();
  const items: any[] = data.items ?? [];

  if (items.length === 0) return { avgPrice: null, count: 0 };

  const prices = items
    .map((item: any) => item.price)
    .filter((p: number) => p > 0)
    .sort((a: number, b: number) => a - b);

  if (prices.length === 0) return { avgPrice: null, count: 0 };

  // 上下10%を除いたトリム平均（外れ値除去）
  const trimCount = Math.max(1, Math.floor(prices.length * 0.1));
  const trimmed = prices.slice(trimCount, prices.length - trimCount);
  const avgPrice = Math.round(
    trimmed.reduce((a: number, b: number) => a + b, 0) / trimmed.length
  );

  return {
    avgPrice,
    count: prices.length,
    minPrice: prices[0],
    maxPrice: prices[prices.length - 1],
  };
}

// ========== APIハンドラー ==========
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("q") ?? "";

  if (!keyword) return Response.json({ avgPrice: null, count: 0 });

  // キャッシュヒット
  const cached = getCached(keyword);
  if (cached) {
    return Response.json({ ...cached, fromCache: true });
  }

  // 同時リクエスト制限
  if (activeRequests >= MAX_CONCURRENT) {
    return Response.json({ avgPrice: null, count: 0 });
  }

  activeRequests++;
  try {
    await randomDelay();
    const result = await searchMercariSold(keyword);
    setCache(keyword, result);
    return Response.json(result);
  } catch {
    return Response.json({ avgPrice: null, count: 0 });
  } finally {
    activeRequests--;
  }
}
