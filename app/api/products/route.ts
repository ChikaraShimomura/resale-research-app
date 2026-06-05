import { kv } from "@vercel/kv";
import { ProfitProduct } from "../../lib/profitFilter";

export async function GET() {
  try {
    const products = await kv.get<ProfitProduct[]>("profitable_products");
    const lastUpdated = await kv.get<string>("last_updated");
    return Response.json({
      products: products ?? [],
      lastUpdated: lastUpdated ?? null,
    });
  } catch {
    return Response.json({ products: [], lastUpdated: null });
  }
}
