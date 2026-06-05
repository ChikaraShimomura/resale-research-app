import { NextRequest } from "next/server";

// メルカリ内部APIで売り切れ商品の平均価格を取得
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("q") ?? "";

  if (!keyword) {
    return Response.json({ avgPrice: null, count: 0 });
  }

  try {
    const body = {
      pageSize: 30,
      pageToken: "",
      searchSessionId: Math.random().toString(36).slice(2),
      indexRouting: "INDEX_ROUTING_UNSPECIFIED",
      thumbnailTypes: [],
      searchCondition: {
        keyword,
        excludeKeyword: "",
        sort: "SORT_CREATED_TIME",
        order: "ORDER_DESC",
        status: ["STATUS_SOLD_OUT"],
        sizeId: [],
        categoryId: [],
        brandId: [],
        sellerId: [],
        priceMin: 0,
        priceMax: 0,
        itemConditionId: [],
        shippingPayerId: [],
        shippingFromArea: [],
        shippingMethod: [],
        colorId: [],
        hasCoupon: false,
        attributes: [],
        itemTypes: [],
        skuIds: [],
      },
      userId: "",
    };

    const res = await fetch("https://api.mercari.jp/v2/entities:search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://jp.mercari.com",
        "Referer": "https://jp.mercari.com/",
        "X-Platform": "web",
        "DPOP": "",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return Response.json({ avgPrice: null, count: 0 });
    }

    const data = await res.json();
    const items: any[] = data.items ?? [];

    if (items.length === 0) {
      return Response.json({ avgPrice: null, count: 0 });
    }

    // 価格の中央値を計算（外れ値を除外）
    const prices = items
      .map((item: any) => item.price)
      .filter((p: number) => p > 0)
      .sort((a: number, b: number) => a - b);

    if (prices.length === 0) {
      return Response.json({ avgPrice: null, count: 0 });
    }

    // 上下10%を除いた平均（トリム平均）
    const trimCount = Math.floor(prices.length * 0.1);
    const trimmed = prices.slice(trimCount, prices.length - trimCount);
    const avgPrice = Math.round(
      trimmed.reduce((a: number, b: number) => a + b, 0) / trimmed.length
    );

    return Response.json({
      avgPrice,
      count: prices.length,
      minPrice: prices[0],
      maxPrice: prices[prices.length - 1],
    });
  } catch (e) {
    return Response.json({ avgPrice: null, count: 0 });
  }
}
