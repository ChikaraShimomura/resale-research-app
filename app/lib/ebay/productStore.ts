import { kvReadOnly } from "../kv";
import { ProfitProduct } from "../profitFilter";
import { applySoldComp } from "./soldComp";

// 出品に使う商品データを取得する。まず現行の利益商品カタログ(profitable_products)、
// 無ければ出品アーカイブ(psnap:{id})から読む。
// アーカイブは refresh が各カタログ商品を2年保存するもの＝商品が利益商品カタログから入れ替わりで
// 外れても、それを「楽天で仕入れる」を押して仕入れた人が出品（prepare/publish）できるようにするため。
// ※ 相場(realAvgPrice)・利益は配信/ランキングと同じく eBay直近落札ベース(あれば)に揃える＝
//   詳細ページ・出品モーダル・損益分岐が実落札価格を基準に計算される（無ければ現在出品相場のまま）。
export async function getProductById(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    const hit = products?.find((p) => p.id === id);
    if (hit) return (await applySoldComp([hit]))[0] ?? hit;
  } catch {
    /* カタログ取得失敗時はアーカイブにフォールバック */
  }
  try {
    const snap = await kvReadOnly.get<ProfitProduct>(`psnap:${id}`);
    if (!snap) return null;
    return (await applySoldComp([snap]))[0] ?? snap;
  } catch {
    return null;
  }
}
