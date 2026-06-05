import { kv } from "@vercel/kv";
import { ProfitProduct } from "../../lib/profitFilter";
import { SAMPLE_PRODUCTS } from "../../lib/sampleProducts";

export async function GET() {
  try {
    const profitable = await kv.get<ProfitProduct[]>("profitable_products");
    if (profitable && profitable.length > 0) {
      const lastUpdated = await kv.get<string>("last_updated");
      return Response.json({ products: profitable, lastUpdated });
    }

    // KVにデータがない場合はサンプル商品を返す（UIプレビュー用）
    return Response.json({
      products: SAMPLE_PRODUCTS,
      lastUpdated: null,
      isSample: true,
    });
  } catch {
    // KV未設定時もサンプルを返す
    return Response.json({
      products: SAMPLE_PRODUCTS,
      lastUpdated: null,
      isSample: true,
    });
  }
}
