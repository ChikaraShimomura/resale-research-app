export type ResellPlatform = "mercari" | "ebay";
export type SourceSite = "rakuten" | "surugaya" | "bookoff";

export interface ProfitInfo {
  platform: ResellPlatform;
  platformName: string;
  avgPrice: number;
  soldCount: number;
  profit: number;
  profitRate: number;
  affiliateUrl: string;
}

export interface SourceInfo {
  site: SourceSite;
  siteName: string;
  price: number;
  url: string;
  pointRate?: number;   // 楽天のみ・任意
  pointAmount?: number;
}

export interface Product {
  id: string;
  title: string;
  titleEn?: string;       // eBay出品用英語タイトル
  descriptionEn?: string; // eBay出品用英語説明文
  imageUrl: string;
  category: string;
  source: SourceInfo;
  profits: ProfitInfo[];
  soldOut?: boolean;
  soldAt?: string;
  isNew?: boolean;
  coreKeyword?: string;
  ebaySoldUrl?: string;    // サーバー側で生成済みeBay実績確認URL
  mercariSoldUrl?: string; // サーバー側で生成済みメルカリ実績確認URL
}
