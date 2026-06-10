export interface SourceInfo {
  site: "rakuten";
  siteName: string;
  price: number;
  url: string;
  pointRate?: number;
  pointAmount?: number;
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
}
