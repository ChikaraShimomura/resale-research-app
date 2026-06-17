import { kvReadOnly } from "../kv";
import { ProfitProduct } from "../profitFilter";

// 出品に使う商品データを取得する。まず現行の利益商品カタログ(profitable_products)、
// 無ければ出品アーカイブ(psnap:{id})から読む。
// アーカイブは refresh が各カタログ商品を2年保存するもの＝商品が利益商品カタログから入れ替わりで
// 外れても、それを「楽天で仕入れる」を押して仕入れた人が出品（prepare/publish）できるようにするため。
export async function getProductById(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    const hit = products?.find((p) => p.id === id);
    if (hit) return hit;
  } catch {
    /* カタログ取得失敗時はアーカイブにフォールバック */
  }
  try {
    const snap = await kvReadOnly.get<ProfitProduct>(`psnap:${id}`);
    return snap ?? null;
  } catch {
    return null;
  }
}
