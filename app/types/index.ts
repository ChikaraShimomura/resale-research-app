export interface SourceInfo {
  site: "rakuten";
  siteName: string;
  price: number;
  url: string;
  pointRate?: number;
  pointAmount?: number;
  shippingJpy?: number;       // 国内送料(楽天→自分)の概算。利益計算に算入済み。送料込みなら0
  postageIncluded?: boolean;  // 楽天で送料込み(postageFlag=0)だったか
}

export interface Product {
  id: string;
  title: string;
  imageUrl: string;
  category: string;
  source: SourceInfo;
  soldOut?: boolean;
  isNew?: boolean;
  coreKeyword?: string;
  ebaySoldUrl?: string;
  avgDaysToSell?: number; // eBay平均販売日数（null=不明）
  market?: string;        // eBayマーケット（EBAY_US / EBAY_GB / EBAY_AU）
}
