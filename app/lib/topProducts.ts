import { kvReadOnly } from "./kv";
import { ProfitProduct } from "./profitFilter";
import { isSold } from "./sold";

// 利益率順・SOLD(飽和)除外の上位利益商品。/ranking と /studio で共用。
export async function getTopProfitProducts(n: number): Promise<ProfitProduct[]> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    if (!Array.isArray(products)) return [];
    try {
      const pipe = kvReadOnly.pipeline();
      products.forEach((p) => pipe.scard(`listing_actors:${p.id}`));
      const counts = (await pipe.exec()) as number[];
      products.forEach((p, i) => { p.listingCount = counts?.[i] ?? 0; });
    } catch {
      products.forEach((p) => { p.listingCount = 0; });
    }
    return products
      .filter((p) => !isSold(p))
      .sort((a, b) => (b.realProfitRate || 0) - (a.realProfitRate || 0))
      .slice(0, n);
  } catch {
    return [];
  }
}
