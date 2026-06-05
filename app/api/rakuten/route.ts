import { NextRequest } from "next/server";
import { Product } from "../../types";

function buildCoreKeyword(title: string): string {
  return title
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/[★☆◆◇●○■□▲△▼▽♪♥♡※〇]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

function toEbaySoldUrl(keyword: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1`;
}

function toMercariSoldUrl(keyword: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1`;
}

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";


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
      const imageUrl = parseImageUrl(it.mediumImageUrls) || parseImageUrl(it.smallImageUrls);
      const coreKw = buildCoreKeyword(it.itemName);

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
        profits: [], // 実績価格が取れたクライアント側で計算・表示
        isNew: false,
        coreKeyword: coreKw,
        ebaySoldUrl: toEbaySoldUrl(coreKw),
        mercariSoldUrl: toMercariSoldUrl(coreKw),
      };
    });

  return Response.json({ products, debug: { total: allItems.length, filtered: products.length, error: lastError || null } });
}
