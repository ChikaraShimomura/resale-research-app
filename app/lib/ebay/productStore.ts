import { kvReadOnly } from "../kv";
import { ProfitProduct } from "../profitFilter";
import { applySoldComp } from "./soldComp";

// 出品に使う商品データを取得する。まず現行の利益商品カタログ(profitable_products)、
// 無ければ出品アーカイブ(psnap:{id})から読む。
// アーカイブは refresh が各カタログ商品を2年保存するもの＝商品が利益商品カタログから入れ替わりで
// 外れても、それを「仕入れる」を押して仕入れた人が出品（prepare/publish）できるようにするため。
// ※ 相場(realAvgPrice)・利益は配信/ランキングと同じく eBay直近落札ベース(あれば)に揃える＝
//   詳細ページ・出品モーダル・損益分岐が実落札価格を基準に計算される（無ければ現在出品相場のまま）。
// 中古品の利益率は「純利益÷仕入れ値(ROI)」に正規化する。古い psnap は「純利益÷想定売値(粗利率)」で
// 焼かれた値が残っており、落札データが無いと applySoldComp を素通りして粗利率(例:9%)が表示に漏れるため。
// 配信集計(getUsedCatalog/getBoughtItems/getFavoriteItems)と定義を必ず揃える。新品モデルは applyDisplayProfit 側で扱うので触らない。
function normalizeUsedRoi(p: ProfitProduct): ProfitProduct {
  const buy = p.source?.price ?? 0;
  const site = String(p.source?.site ?? "");
  const isUsed = !!p.id?.startsWith("used-") || site === "hardoff" || site === "2ndstreet";
  if (!isUsed || !(buy > 0)) return p;
  return { ...p, realProfitRate: Math.round(((p.realProfit ?? 0) / buy) * 100) };
}

export async function getProductById(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    const hit = products?.find((p) => p.id === id);
    if (hit) return normalizeUsedRoi((await applySoldComp([hit]))[0] ?? hit);
  } catch {
    /* カタログ取得失敗時はアーカイブにフォールバック */
  }
  try {
    const snap = await kvReadOnly.get<ProfitProduct>(`psnap:${id}`);
    if (!snap) return null;
    return normalizeUsedRoi((await applySoldComp([snap]))[0] ?? snap);
  } catch {
    return null;
  }
}
