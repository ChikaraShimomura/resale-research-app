import { Product } from "../types";

export interface ProfitProduct extends Product {
  realAvgPrice: number;  // eBay最安値ベースの参照価格（早く売る前提・円換算）。表示と利益の基準。
  realMedianPrice?: number; // eBay中央値（併記・参考用）
  realProfit: number;    // 利益額
  realProfitRate: number; // 利益率（%）
  realCount: number;     // 相場の参照件数
  addedAt?: string;      // 初回登録時刻（ISO）。登録順ソート用
  listingCount?: number; // eBay簡単出品が押された回数（ライバル数の目安）。/api/products が付与
}
