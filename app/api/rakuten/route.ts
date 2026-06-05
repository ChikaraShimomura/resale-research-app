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

// eBayで売れやすいジャンルを網羅するキーワード一覧
const ALL_KEYWORDS = [
  "ポケモンカード トレカ",
  "遊戯王 ワンピース カード",
  "ガンプラ MG RG HG",
  "フィギュア アニメ",
  "LEGO レゴ",
  "ゲーム Switch PS5",
  "おもちゃ キャラクター",
  "コスメ スキンケア 日焼け止め",
  "腕時計 セイコー シチズン",
  "カメラ フィルムカメラ",
  "漫画 全巻",
  "スニーカー 限定",
  "和雑貨 工芸",
  "ボードゲーム",
  "楽器 ギター",
];

function parseImageUrl(urls: any): string {
  if (!urls) return "";
  if (Array.isArray(urls) && urls.length > 0) return urls[0]?.imageUrl ?? "";
  if (typeof urls === "string") return urls;
  return "";
}

// In-memory cache (1h TTL)
const pageCache = new Map<string, { items: any[]; expiresAt: number }>();
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

// 1キーワードで3ページ取得（最大90件）
async function fetchKeyword(keyword: string): Promise<any[]> {
  const p1 = await fetchPage(keyword, 1);
  await sleep(700);
  const p2 = p1.length >= 30 ? await fetchPage(keyword, 2) : [];
  await sleep(700);
  const p3 = p2.length >= 30 ? await fetchPage(keyword, 3) : [];
  return [...p1, ...p2, ...p3];
}

function toProduct(it: any, keyword: string): Product {
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
    isNew: false,
    coreKeyword: coreKw,
    ebaySoldUrl: toEbaySoldUrl(coreKw),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userKeyword = searchParams.get("keyword") ?? "";

  // ユーザーが検索キーワードを指定した場合はそのキーワードのみ
  if (userKeyword) {
    const items = await fetchKeyword(userKeyword);
    const seen = new Set<string>();
    const products: Product[] = items
      .filter((item: any) => {
        const id = item.Item?.itemCode;
        if (!id || seen.has(id) || item.Item?.itemPrice < 1000) return false;
        seen.add(id);
        return true;
      })
      .map((item: any) => toProduct(item.Item, userKeyword));

    return Response.json({ products, debug: { total: items.length, filtered: products.length } });
  }

  // キーワード未指定（ホーム画面）= 全ジャンルを順番に取得して合算
  const seen = new Set<string>();
  const allProducts: Product[] = [];

  for (const kw of ALL_KEYWORDS) {
    const items = await fetchKeyword(kw);
    for (const item of items) {
      const it = item.Item;
      if (!it || it.itemPrice < 1000) continue;
      if (seen.has(it.itemCode)) continue;
      seen.add(it.itemCode);
      allProducts.push(toProduct(it, kw));
    }
    // キーワード間のインターバル（429対策）
    await sleep(800);
  }

  return Response.json({
    products: allProducts,
    debug: { total: allProducts.length, filtered: allProducts.length },
  });
}
