import { kvReadOnly } from "./kv";
import { ProfitProduct } from "./profitFilter";
import { applyDisplayProfit } from "./displayProfit";
import { applySoldComp } from "./ebay/soldComp";

// 利益率順の上位利益商品。/ranking と /studio で共用。
// 表示の利益/利益率は配信(/api/products)と同じ「現金純利益（ポイント抜き・着地コスト後）」に揃える。
// 相場の基準も配信と同じ＝eBay直近落札(あれば)→現在出品相場(フォールバック)。
export async function getTopProfitProducts(n: number): Promise<ProfitProduct[]> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    if (!Array.isArray(products)) return [];
    const withSold = await applySoldComp(products);
    return withSold
      .map(applyDisplayProfit)
      .sort((a, b) => (b.realProfitRate || 0) - (a.realProfitRate || 0))
      .slice(0, n);
  } catch {
    return [];
  }
}
