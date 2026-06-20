import { kvReadOnly } from "./kv";
import { ProfitProduct } from "./profitFilter";
import { applyDisplayProfit } from "./displayProfit";

// 利益率順の上位利益商品。/ranking と /studio で共用。
// 表示の利益/利益率は配信(/api/products)と同じ「現金純利益（ポイント抜き・着地コスト後）」に揃える。
export async function getTopProfitProducts(n: number): Promise<ProfitProduct[]> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    if (!Array.isArray(products)) return [];
    return products
      .map(applyDisplayProfit)
      .sort((a, b) => (b.realProfitRate || 0) - (a.realProfitRate || 0))
      .slice(0, n);
  } catch {
    return [];
  }
}
