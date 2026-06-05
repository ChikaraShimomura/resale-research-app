import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

export function toRakutenAffiliateUrl(productUrl: string): string {
  const encoded = encodeURIComponent(productUrl);
  return `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_AFFILIATE_ID}/?pc=${encoded}&link_type=text`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatJpy(amount: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(amount);
}

export function getProfitBadgeStyle(rate: number): string {
  if (rate >= 30) return "bg-green-100 text-green-700 border-green-200";
  if (rate >= 10) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-red-100 text-red-600 border-red-200";
}

// eBay出品URL（タイトル・説明文を事前入力）
export function toEbayListingUrl(titleEn: string, descriptionEn: string): string {
  const params = new URLSearchParams({
    title: titleEn,
    description: descriptionEn,
  });
  return `https://www.ebay.com/sl/list?${params.toString()}`;
}

// メルカリ出品URL（写真撮影から出品できる出品ページ）
export function toMercariListingUrl(): string {
  return "https://jp.mercari.com/sell/item";
}

const SOLD_EXPIRY_MS = 36 * 60 * 60 * 1000;

export function isSoldExpired(soldAt?: string): boolean {
  if (!soldAt) return false;
  return Date.now() - new Date(soldAt).getTime() > SOLD_EXPIRY_MS;
}
