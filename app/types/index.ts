export interface SourceInfo {
  site: "rakuten";
  siteName: string;
  price: number;
  url: string;
  pointRate?: number;
  pointAmount?: number;
  shippingJpy?: number;       // 国内送料(仕入れ元→自分)の概算。利益計算に算入済み。送料込みなら0
  postageIncluded?: boolean;  // 送料込み(postageFlag=0)だったか
}

export interface Product {
  id: string;
  title: string;
  imageUrl: string;        // 代表画像（ギャラリー先頭）
  images?: string[];       // ギャラリー画像（最大3・複数画像出品用）
  category: string;
  source: SourceInfo;
  soldOut?: boolean;
  isNew?: boolean;
  coreKeyword?: string;
  ebaySoldUrl?: string;
  avgDaysToSell?: number; // eBay平均販売日数（null=不明）
  market?: string;        // eBayマーケット（EBAY_US / EBAY_GB / EBAY_AU）
}
