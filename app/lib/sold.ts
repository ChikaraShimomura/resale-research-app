import { ProfitProduct } from "./profitFilter";

// 1商品につき、輸出ラボから出品できる人数(端末)の上限。これ「以上」で満了(SOLD)。
// 共有カタログでの共食い（同じ商品に出品が殺到→eBayで価格崩壊）を防ぐ希少性ガード。
// 効果：① /api/products は満了商品を一覧から隠す ② publish は上限到達商品の新規出品をブロック。
// しきい値は定数1個＝実データ（ユーザーが利益を出せているか）を見ていつでも調整可。
export const SOLD_THRESHOLD = 10;

// 満了(SOLD)判定。出品者数(listing_actors の人数)が上限以上なら満了。
export function isSold(p: ProfitProduct, liveCount?: number): boolean {
  const count = liveCount ?? p.listingCount ?? 0;
  return count >= SOLD_THRESHOLD;
}
