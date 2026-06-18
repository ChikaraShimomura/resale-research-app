import { kvReadOnly } from "./kv";
import { ProfitProduct } from "./profitFilter";

// 利益率順の上位利益商品。/ranking と /studio で共用。
export async function getTopProfitProducts(n: number): Promise<ProfitProduct[]> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    if (!Array.isArray(products)) return [];
    return products
      .sort((a, b) => (b.realProfitRate || 0) - (a.realProfitRate || 0))
      .slice(0, n);
  } catch {
    return [];
  }
}
