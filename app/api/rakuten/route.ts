import { NextRequest } from "next/server";
import { Product } from "../../types";
import { toRakutenAffiliateUrl } from "../../lib/utils";

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID!;
const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

// eBay手数料・送料の概算
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 40; // $0.30 ≈ ¥40
const INTL_SHIPPING = 2250; // 〜500g EMS
const USD_JPY = 150;

function calcEbayProfit(buyPrice: number): { avgPrice: number; profit: number; profitRate: number } {
  // eBay想定売価 = 仕入れ価格の2倍（概算）
  const avgPrice = Math.round(buyPrice * 2);
  const fees = Math.round(avgPrice * EBAY_FEE_RATE + EBAY_FEE_FIXED);
  const profit = avgPrice - buyPrice - fees - INTL_SHIPPING;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

function calcMercariProfit(buyPrice: number): { avgPrice: number; profit: number; profitRate: number } {
  // メルカリ想定売価 = 仕入れ価格の1.5倍（概算）
  const avgPrice = Math.round(buyPrice * 1.5);
  const fees = Math.round(avgPrice * 0.1); // メルカリ手数料10%
  const profit = avgPrice - buyPrice - fees;
  const profitRate = Math.round((profit / buyPrice) * 100);
  return { avgPrice, profit, profitRate };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword") ?? "フィギュア";
  const genreId = searchParams.get("genreId") ?? "";

  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    keyword,
    hits: "20",
    sort: "-reviewCount",
    format: "json",
    ...(genreId ? { genreId } : {}),
  });

  const res = await fetch(
    `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?${params}`,
    { next: { revalidate: 7200 } } // 2時間キャッシュ
  );

  if (!res.ok) {
    return Response.json({ error: "Rakuten API error" }, { status: 500 });
  }

  const data = await res.json();
  const items = data.Items ?? [];

  const products: Product[] = items
    .filter((item: any) => item.Item.itemPrice > 500)
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
    })
    .filter((p: Product) => p.profits.some((pr) => pr.profit > 0));

  return Response.json({ products });
}
