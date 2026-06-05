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

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

// ソート順を変えて幅広く取得（ジャンル縛りなし）
const SORT_ORDERS = [
  "-reviewCount",   // レビュー多い順
  "-seller",        // 売れている順
  "-reviewAverage", // 評価高い順
  "+price",         // 安い順
  "-price",         // 高い順
];

function parseImageUrl(urls: any): string {
  if (!urls) return "";
  if (Array.isArray(urls) && urls.length > 0) return urls[0]?.imageUrl ?? "";
  if (typeof urls === "string") return urls;
  return "";
}

const pageCache = new Map<string, { items: any[]; expiresAt: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(keyword: string, page: number, sort: string): Promise<any[]> {
  const cacheKey = `${keyword}__${sort}__p${page}`;
  const cached = pageCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.items;

  const headers = {
    "Referer": "https://www.yushutsu-fukugyo.com",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params = new URLSearchParams({
        applicationId: RAKUTEN_APP_ID,
        accessKey: RAKUTEN_ACCESS_KEY,
        affiliateId: RAKUTEN_AFFILIATE_ID,
        hits: "30",
        page: String(page),
        sort,
        format: "json",
      });
      if (keyword) params.set("keyword", keyword);

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
        await sleep(2000 * (attempt + 1));
        continue;
      }
      break;
    } catch {
      break;
    }
  }
  return [];
}

// ソート順1種類で5ページ取得（最大150件）
async function fetchBySortOrder(keyword: string, sort: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const items = await fetchPage(keyword, page, sort);
    all.push(...items);
    if (items.length < 30) break;
    await sleep(700);
  }
  return all;
}

function toProduct(it: any): Product {
  const price: number = it.itemPrice;
  const imageUrl = parseImageUrl(it.mediumImageUrls) || parseImageUrl(it.smallImageUrls);
  const coreKw = buildCoreKeyword(it.itemName);
  return {
    id: it.itemCode,
    title: it.itemName,
    imageUrl,
    category: "",
    source: {
      site: "rakuten",
      siteName: "楽天",
      price,
      url: it.affiliateUrl || it.itemUrl,
      pointRate: it.pointRate,
      pointAmount: Math.floor(price * (it.pointRate ?? 1) / 100),
    },
    isNew: false,
    coreKeyword: coreKw,
    ebaySoldUrl: toEbaySoldUrl(coreKw),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userKeyword = searchParams.get("keyword") ?? "";

  const seen = new Set<string>();
  const products: Product[] = [];

  if (userKeyword) {
    // ユーザー検索：指定キーワードで3ページ
    for (let page = 1; page <= 3; page++) {
      const items = await fetchPage(userKeyword, page, "-reviewCount");
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000 || seen.has(it.itemCode)) continue;
        seen.add(it.itemCode);
        products.push(toProduct(it));
      }
      if (items.length < 30) break;
      await sleep(700);
    }
  } else {
    // ホーム画面：ソート順を変えて幅広く取得（ジャンル縛りなし）
    for (const sort of SORT_ORDERS) {
      const items = await fetchBySortOrder("", sort);
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000 || seen.has(it.itemCode)) continue;
        seen.add(it.itemCode);
        products.push(toProduct(it));
      }
      await sleep(800);
    }
  }

  return Response.json({
    products,
    debug: { total: products.length },
  });
}
