import { Product } from "../types";

export interface ProfitProduct extends Product {
  realAvgPrice: number;  // eBay落札平均価格（円換算）
  realProfit: number;    // 利益額
  realProfitRate: number; // 利益率（%）
  realCount: number;     // 落札件数
  addedAt?: string;      // 初回登録時刻（ISO）。登録順ソート用
  listingCount?: number; // eBay簡単出品が押された回数（ライバル数の目安）。/api/products が付与
}
