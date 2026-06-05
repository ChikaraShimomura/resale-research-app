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

// カテゴリ別メルカリ想定倍率と送料
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

function getMercariConfig(keyword: string) {
  for (const [key, val] of Object.entries(MERCARI_CONFIG)) {
    if (keyword.includes(key)) return val;
  }
  return MERCARI_CONFIG["default"];
}

function calcMercariProfit(buyPrice: number, keyword: string) {
  const mercariCfg = getMercariConfig(keyword);
  const avgPrice = Math.round(buyPrice * mercariCfg.markup);
  const fees = Math.round(avgPrice * 0.1); // メルカリ手数料10%
  const profit = avgPrice - buyPrice - fees - mercariCfg.shipping;
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

async function fetchRakutenPage(keyword: string, page: number): Promise<any[]> {
  const config = getConfig(keyword);
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
    `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.Items ?? [];
}

export async function searchRakuten(keyword: string): Promise<Product[]> {
  const config = getConfig(keyword);

  // 3ページを並列取得（最大90件）
  const pages = await Promise.allSettled([
    fetchRakutenPage(keyword, 1),
    fetchRakutenPage(keyword, 2),
    fetchRakutenPage(keyword, 3),
  ]);

  const items: any[] = pages.flatMap((p) =>
    p.status === "fulfilled" ? p.value : []
  );

  // 重複除去
  const seen = new Set<string>();
  const unique = items.filter((item: any) => {
    const id = item.Item.itemCode;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return unique
    .filter((item: any) => item.Item.itemPrice >= 1000)
    .map((item: any): Product => {

      const it = item.Item;
      const price: number = it.itemPrice;
      const ebay = calcEbayProfit(price, config.markup, config.shipping);
      const mercari = calcMercariProfit(price, keyword);
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
    })
    // eBay・メルカリ双方で利益がでない商品は除外
    .filter((product) =>
      product.profits.some((p) => p.profit > 0)
    );
}
