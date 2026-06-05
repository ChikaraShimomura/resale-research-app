import { Product } from "../types";

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 40;

// カテゴリ別eBay想定倍率と送料
const CATEGORY_CONFIG: Record<string, { markup: number; shipping: number }> = {
  "フィギュア":    { markup: 2.2, shipping: 1500 },
  "ゲーム":        { markup: 1.8, shipping: 1000 },
  "おもちゃ":      { markup: 1.8, shipping: 1500 },
  "アニメ":        { markup: 2.0, shipping: 1200 },
  "ヴィンテージ":  { markup: 2.5, shipping: 1500 },
  "ファッション":  { markup: 2.0, shipping: 1200 },
  "コスメ":        { markup: 1.8, shipping: 800  },
  "家電":          { markup: 1.5, shipping: 2000 },
  "default":       { markup: 1.8, shipping: 1500 },
};

function getConfig(keyword: string) {
  for (const [key, val] of Object.entries(CATEGORY_CONFIG)) {
    if (keyword.includes(key)) return val;
  }
  return CATEGORY_CONFIG["default"];
}

function calcEbayProfit(buyPrice: number, markup: number, shipping: number) {
  const avgPrice = Math.round(buyPrice * markup);
  const fees = Math.round(avgPrice * EBAY_FEE_RATE + EBAY_FEE_FIXED);
  const profit = avgPrice - buyPrice - fees - shipping;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

function calcMercariProfit(buyPrice: number) {
  const avgPrice = Math.round(buyPrice * 1.4);
  const fees = Math.round(avgPrice * 0.1);
  const profit = avgPrice - buyPrice - fees;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

function parseImageUrls(urls: any): string {
  if (!urls) return "";
  if (Array.isArray(urls) && urls.length > 0) {
    return urls[0]?.imageUrl ?? "";
  }
  if (typeof urls === "string") return urls;
  return "";
}

export async function searchRakuten(keyword: string): Promise<Product[]> {
  const config = getConfig(keyword);

  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    keyword,
    hits: "20",
    sort: "-reviewCount",
    format: "json",
  });

  const res = await fetch(
    `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`
  );

  if (!res.ok) throw new Error("Rakuten API error");

  const data = await res.json();
  const items: any[] = data.Items ?? [];

  return items
    .filter((item: any) => item.Item.itemPrice >= 1000)
    .map((item: any): Product => {
      const it = item.Item;
      const price: number = it.itemPrice;
      const ebay = calcEbayProfit(price, config.markup, config.shipping);
      const mercari = calcMercariProfit(price);
      const imageUrl = parseImageUrls(it.mediumImageUrls) || parseImageUrls(it.smallImageUrls);

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
    });
}
