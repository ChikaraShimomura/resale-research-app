import { Product } from "../types";

const RAKUTEN_APP_ID = "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 40;
const INTL_SHIPPING = 1500;

function calcEbayProfit(buyPrice: number) {
  const avgPrice = Math.round(buyPrice * 2);
  const fees = Math.round(avgPrice * EBAY_FEE_RATE + EBAY_FEE_FIXED);
  const profit = avgPrice - buyPrice - fees - INTL_SHIPPING;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

function calcMercariProfit(buyPrice: number) {
  const avgPrice = Math.round(buyPrice * 1.5);
  const fees = Math.round(avgPrice * 0.1);
  const profit = avgPrice - buyPrice - fees;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

export async function searchRakuten(keyword: string): Promise<Product[]> {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    keyword,
    hits: "20",
    sort: "-reviewCount",
    format: "json",
  });

  const res = await fetch(
    `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?${params}`
  );

  if (!res.ok) throw new Error("Rakuten API error");

  const data = await res.json();
  const items: any[] = data.Items ?? [];

  return items
    .filter((item: any) => item.Item.itemPrice >= 1000)
    .map((item: any): Product => {
      const it = item.Item;
      const price: number = it.itemPrice;
      const ebay = calcEbayProfit(price);
      const mercari = calcMercariProfit(price);

      return {
        id: it.itemCode,
        title: it.itemName,
        imageUrl: it.mediumImageUrls?.[0]?.imageUrl ?? "",
        category: it.genreName ?? "その他",
        source: {
          site: "rakuten",
          siteName: "楽天",
          price,
          url: it.itemUrl,
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
