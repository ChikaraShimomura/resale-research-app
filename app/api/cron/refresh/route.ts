import { kv } from "@vercel/kv";
import { Product } from "../../../types";
import { ProfitProduct } from "../../../lib/profitFilter";

export const maxDuration = 300;

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";
const USD_TO_JPY = 155;
const EBAY_SHIPPING = 500;
const MIN_PROFIT = 500;

// ジャンル縛りなし：ソート順を変えて楽天全体を幅広く取得
const SORT_ORDERS = [
  "-reviewCount",
  "-seller",
  "-reviewAverage",
  "+price",
  "-price",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function parseImageUrl(urls: any): string {
  if (!urls) return "";
  if (Array.isArray(urls) && urls.length > 0) return urls[0]?.imageUrl ?? "";
  return "";
}

function toEbaySoldUrl(keyword: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1`;
}

async function fetchRakutenPage(page: number, sort: string): Promise<any[]> {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    hits: "30",
    page: String(page),
    sort,
    format: "json",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`,
        {
          headers: { "Referer": "https://www.yushutsu-fukugyo.com", "User-Agent": "Mozilla/5.0" },
          cache: "no-store",
        }
      );
      if (res.ok) return (await res.json()).Items ?? [];
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      break;
    } catch { break; }
  }
  return [];
}

async function getEbayAvgPrice(keyword: string, rakutenPrice: number): Promise<{ avgPrice: number; count: number } | null> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1&_ipg=60`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const prices: number[] = [];
    const priceRegex = /class="s-item__price"[^>]*>\s*(?:US )?\$?([\d,]+\.?\d*)/g;
    let m;
    while ((m = priceRegex.exec(html)) !== null) {
      const usd = parseFloat(m[1].replace(/,/g, ""));
      if (usd > 0) prices.push(Math.round(usd * USD_TO_JPY));
    }
    if (prices.length === 0) return null;

    const filtered = prices.filter((p) => p >= rakutenPrice * 0.5 && p <= rakutenPrice * 5);
    if (filtered.length === 0) return null;

    const sorted = [...filtered].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const valid = sorted.filter((p) => p >= median * 0.5 && p <= median * 2);
    if (valid.length === 0) return null;

    return {
      avgPrice: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length),
      count: valid.length,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const seen = new Set<string>();
  const allProducts: Product[] = [];

  // ① ジャンル縛りなしで楽天から幅広く取得
  for (const sort of SORT_ORDERS) {
    for (let page = 1; page <= 5; page++) {
      const items = await fetchRakutenPage(page, sort);
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000 || seen.has(it.itemCode)) continue;
        seen.add(it.itemCode);
        const coreKw = buildCoreKeyword(it.itemName);
        allProducts.push({
          id: it.itemCode,
          title: it.itemName,
          imageUrl: parseImageUrl(it.mediumImageUrls) || parseImageUrl(it.smallImageUrls),
          category: "",
          source: {
            site: "rakuten",
            siteName: "楽天",
            price: it.itemPrice,
            url: it.affiliateUrl || it.itemUrl,
            pointRate: it.pointRate,
            pointAmount: Math.floor(it.itemPrice * (it.pointRate ?? 1) / 100),
          },
          isNew: false,
          coreKeyword: coreKw,
          ebaySoldUrl: toEbaySoldUrl(coreKw),
        });
      }
      if (items.length < 30) break;
      await sleep(700);
    }
    await sleep(800);
  }

  // ② eBayと比較して利益が出るものだけ残す
  const profitable: ProfitProduct[] = [];
  const BATCH = 5;

  for (let i = 0; i < allProducts.length; i += BATCH) {
    const batch = allProducts.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (product) => {
        const ebay = await getEbayAvgPrice(product.coreKeyword ?? product.title, product.source.price);
        if (!ebay) return null;

        const fee = Math.round(ebay.avgPrice * 0.1);
        const profit = ebay.avgPrice - product.source.price - fee - EBAY_SHIPPING;
        if (profit < MIN_PROFIT) return null;

        return {
          ...product,
          realAvgPrice: ebay.avgPrice,
          realProfit: profit,
          realProfitRate: Math.round((profit / product.source.price) * 100),
          realCount: ebay.count,
        } as ProfitProduct;
      })
    );
    for (const r of results) {
      if (r) profitable.push(r);
    }
    await sleep(300);
  }

  // ③ 利益率順に保存
  profitable.sort((a, b) => b.realProfitRate - a.realProfitRate);
  await kv.set("profitable_products", profitable, { ex: 60 * 60 * 14 });
  await kv.set("last_updated", new Date().toISOString());

  return Response.json({
    ok: true,
    rakutenTotal: allProducts.length,
    profitableCount: profitable.length,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
  });
}
