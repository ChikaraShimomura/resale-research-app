import { NextRequest } from "next/server";
import { Product } from "../../types";

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 40;

const CATEGORY_CONFIG: Record<string, { markup: number; shipping: number }> = {
  "フィギュア":    { markup: 2.2, shipping: 1500 },
  "ゲーム":        { markup: 1.8, shipping: 1000 },
  "おもちゃ":      { markup: 1.8, shipping: 1500 },
  "アニメ":        { markup: 2.0, shipping: 1200 },
  "ヴィンテージ":  { markup: 2.5, shipping: 1500 },
  "ファッション":  { markup: 2.0, shipping: 1200 },
  "コスメ":        { markup: 1.8, shipping: 800  },
  "家電":          { markup: 1.5, shipping: 2000 },
  "トレカ":        { markup: 2.5, shipping: 500  },
  "ガンプラ":      { markup: 2.2, shipping: 1200 },
  "LEGO":          { markup: 2.0, shipping: 2000 },
  "レゴ":          { markup: 2.0, shipping: 2000 },
  "CD":            { markup: 2.0, shipping: 800  },
  "レコード":      { markup: 2.5, shipping: 1000 },
  "漫画":          { markup: 1.8, shipping: 1500 },
  "画集":          { markup: 2.2, shipping: 1200 },
  "腕時計":        { markup: 2.0, shipping: 1000 },
  "時計":          { markup: 2.0, shipping: 1000 },
  "和雑貨":        { markup: 2.5, shipping: 1500 },
  "工芸":          { markup: 2.3, shipping: 1500 },
  "ボードゲーム":  { markup: 2.0, shipping: 1500 },
  "カメラ":        { markup: 2.0, shipping: 1500 },
  "フィルム":      { markup: 2.2, shipping: 500  },
  "スニーカー":    { markup: 2.0, shipping: 1200 },
  "楽器":          { markup: 1.8, shipping: 2500 },
  "スポーツ":      { markup: 1.7, shipping: 1500 },
  "default":       { markup: 1.8, shipping: 1500 },
};

const MERCARI_CONFIG: Record<string, { markup: number; shipping: number }> = {
  "フィギュア":    { markup: 1.6, shipping: 600  },
  "ゲーム":        { markup: 1.5, shipping: 400  },
  "おもちゃ":      { markup: 1.5, shipping: 600  },
  "アニメ":        { markup: 1.6, shipping: 500  },
  "ヴィンテージ":  { markup: 1.8, shipping: 600  },
  "ファッション":  { markup: 1.5, shipping: 500  },
  "コスメ":        { markup: 1.4, shipping: 300  },
  "家電":          { markup: 1.3, shipping: 1000 },
  "トレカ":        { markup: 1.8, shipping: 200  },
  "ガンプラ":      { markup: 1.6, shipping: 500  },
  "LEGO":          { markup: 1.6, shipping: 800  },
  "レゴ":          { markup: 1.6, shipping: 800  },
  "CD":            { markup: 1.5, shipping: 300  },
  "レコード":      { markup: 1.7, shipping: 500  },
  "漫画":          { markup: 1.5, shipping: 600  },
  "腕時計":        { markup: 1.6, shipping: 400  },
  "時計":          { markup: 1.6, shipping: 400  },
  "和雑貨":        { markup: 1.7, shipping: 600  },
  "ボードゲーム":  { markup: 1.5, shipping: 600  },
  "カメラ":        { markup: 1.5, shipping: 700  },
  "スニーカー":    { markup: 1.6, shipping: 500  },
  "楽器":          { markup: 1.5, shipping: 1000 },
  "スポーツ":      { markup: 1.4, shipping: 600  },
  "default":       { markup: 1.4, shipping: 500  },
};

function getEbayConfig(keyword: string) {
  for (const [key, val] of Object.entries(CATEGORY_CONFIG)) {
    if (keyword.includes(key)) return val;
  }
  return CATEGORY_CONFIG["default"];
}

function getMercariConfig(keyword: string) {
  for (const [key, val] of Object.entries(MERCARI_CONFIG)) {
    if (keyword.includes(key)) return val;
  }
  return MERCARI_CONFIG["default"];
}

function calcEbayProfit(buyPrice: number, markup: number, shipping: number) {
  const avgPrice = Math.round(buyPrice * markup);
  const fees = Math.round(avgPrice * EBAY_FEE_RATE + EBAY_FEE_FIXED);
  const profit = avgPrice - buyPrice - fees - shipping;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

function calcMercariProfit(buyPrice: number, keyword: string) {
  const cfg = getMercariConfig(keyword);
  const avgPrice = Math.round(buyPrice * cfg.markup);
  const fees = Math.round(avgPrice * 0.1);
  const profit = avgPrice - buyPrice - fees - cfg.shipping;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

function parseImageUrl(urls: any): string {
  if (!urls) return "";
  if (Array.isArray(urls) && urls.length > 0) return urls[0]?.imageUrl ?? "";
  if (typeof urls === "string") return urls;
  return "";
}

// In-memory cache to avoid hammering Rakuten API (1h TTL)
const pageCache = new Map<string, { items: any[]; expiresAt: number }>();

let lastError = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(keyword: string, page: number): Promise<any[]> {
  const cacheKey = `${keyword}__p${page}`;
  const cached = pageCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.items;

  const headers = {
    "Referer": "https://www.yushutsu-fukugyo.com",
    "Origin": "https://www.yushutsu-fukugyo.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  // Retry up to 3 times on 429
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params = new URLSearchParams({
        applicationId: RAKUTEN_APP_ID,
        accessKey: RAKUTEN_ACCESS_KEY,
        affiliateId: RAKUTEN_AFFILIATE_ID,
        keyword,
        hits: "30",
        page: String(page),
        sort: "-reviewCount",
        format: "json",
      });

      const res = await fetch(
        `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`,
        { headers, cache: "no-store" }
      );

      if (res.ok) {
        const data = await res.json();
        const items = data.Items ?? [];
        pageCache.set(cacheKey, { items, expiresAt: Date.now() + 3600_000 });
        return items;
      }

      if (res.status === 429) {
        lastError = `429 rate limit (attempt ${attempt + 1})`;
        await sleep(1500 * (attempt + 1));
        continue;
      }

      const errText = await res.text().catch(() => "");
      lastError = `new API ${res.status}: ${errText.slice(0, 200)}`;
      break;
    } catch (e) {
      lastError = `new API exception: ${e}`;
      break;
    }
  }

  return [];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword") ?? "フィギュア おもちゃ";

  const ebayConfig = getEbayConfig(keyword);

  // Sequential fetch to avoid 429 rate limit
  const page1 = await fetchPage(keyword, 1);
  await sleep(600);
  const page2 = page1.length >= 30 ? await fetchPage(keyword, 2) : [];
  await sleep(600);
  const page3 = page2.length >= 30 ? await fetchPage(keyword, 3) : [];

  const allItems = [...page1, ...page2, ...page3];

  // Dedup
  const seen = new Set<string>();
  const unique = allItems.filter((item: any) => {
    const id = item.Item?.itemCode;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const products: Product[] = unique
    .filter((item: any) => item.Item?.itemPrice >= 1000)
    .map((item: any): Product => {
      const it = item.Item;
      const price: number = it.itemPrice;
      const ebay = calcEbayProfit(price, ebayConfig.markup, ebayConfig.shipping);
      const mercari = calcMercariProfit(price, keyword);
      const imageUrl = parseImageUrl(it.mediumImageUrls) || parseImageUrl(it.smallImageUrls);

      return {
        id: it.itemCode,
        title: it.itemName,
        imageUrl,
        category: keyword,
        source: {
          site: "rakuten",
          siteName: "楽天",
          price,
          url: it.affiliateUrl || it.itemUrl,
          pointRate: it.pointRate,
          pointAmount: Math.floor(price * (it.pointRate ?? 1) / 100),
        },
        profits: [
          {
            platform: "ebay",
            platformName: "eBay",
            avgPrice: ebay.avgPrice,
            soldCount: 30,
            profit: ebay.profit,
            profitRate: ebay.profitRate,
            affiliateUrl: "",
          },
          {
            platform: "mercari",
            platformName: "メルカリ",
            avgPrice: mercari.avgPrice,
            soldCount: 20,
            profit: mercari.profit,
            profitRate: mercari.profitRate,
            affiliateUrl: "",
          },
        ],
        isNew: false,
      };
    })
    .filter((product) => product.profits.some((p) => p.profit > 0));

  return Response.json({ products, debug: { total: allItems.length, filtered: products.length, error: lastError || null } });
}
