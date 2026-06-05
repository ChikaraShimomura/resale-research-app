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

export function toEbaySoldUrl(keyword: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1`;
}

export function toEbayListingUrl(title: string): string {
  return `https://www.ebay.com/sl/list?title=${encodeURIComponent(title)}`;
}

