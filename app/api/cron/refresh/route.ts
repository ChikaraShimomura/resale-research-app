import { kv } from "@vercel/kv";
import { Product } from "../../../types";

// Vercel Hobby: 10秒制限 / Pro: 60秒 / Enterprise: 300秒
// 楽天取得のみ行い、eBay比較はeBay API承認後に追加予定
export const maxDuration = 60;

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

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
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) return (await res.json()).Items ?? [];
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      break;
    } catch { break; }
  }
  return [];
}

export async function GET(req: Request) {
  // Vercel Cron認証
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const seen = new Set<string>();
  const allProducts: Product[] = [];

  // ソート順を変えて楽天全体を幅広く取得（タイムアウト考慮で3ページまで）
  for (const sort of SORT_ORDERS) {
    for (let page = 1; page <= 3; page++) {
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
      await sleep(500);
    }
    await sleep(600);
  }

  // KVに楽天商品を保存（eBay比較はeBay API承認後に追加）
  // TODO: eBay API承認後、ここでeBay比較→利益商品のみ保存に変更
  await kv.set("rakuten_products", allProducts, { ex: 60 * 60 * 14 });
  await kv.set("last_updated", new Date().toISOString());

  return Response.json({
    ok: true,
    count: allProducts.length,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
  });
}
