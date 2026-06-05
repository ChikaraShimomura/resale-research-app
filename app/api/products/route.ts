import { kv } from "@vercel/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import { Product } from "../../types";

export async function GET() {
  try {
    // eBay API承認後は profitable_products を使う
    // 現在は rakuten_products（利益計算前の楽天商品）を返す
    const profitable = await kv.get<ProfitProduct[]>("profitable_products");
    if (profitable && profitable.length > 0) {
      const lastUpdated = await kv.get<string>("last_updated");
      return Response.json({ products: profitable, lastUpdated });
    }

    // fallback: 楽天商品（利益計算なし）は表示しない
    // データが溜まるまでは空を返す
    const lastUpdated = await kv.get<string>("last_updated");
    return Response.json({ products: [] as ProfitProduct[], lastUpdated });
  } catch {
    return Response.json({ products: [] as ProfitProduct[], lastUpdated: null });
  }
}
