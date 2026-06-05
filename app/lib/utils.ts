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

// 楽天タイトルからノイズを除去してコアキーワードを抽出
export function extractCoreKeyword(title: string): string {
  // Step1: 【】と()を完全除去してクリーンなタイトルに
  const cleaned = title
    .replace(/【[^】]*】/g, "")   // 【】とその中身を全消し
    .replace(/\([^)]*\)/g, "")   // ()とその中身を全消し
    .replace(/（[^）]*）/g, "")  // 全角()も除去
    .replace(/[★☆◆◇●○■□▲△▼▽♪♥♡※〇]/g, "")
    .replace(/送料無料|送料込|新品|未開封|未使用|正規品|国内正規|日本正規|セール|特典付き?|プレゼント|ギフト|包装|ラッピング|代引き?不可|あす楽|即日発送|在庫あり|お買い得|お得|激安|大人気/g, "")
    .replace(/\d+個セット|\d+枚セット|\d+本セット|\d+点セット|\d+体セット|\d+冊セット/g, "")
    .replace(/互換|風|もどき/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Step2: 製品番号を抽出（最優先）
  const numCode = cleaned.match(/\b\d{4,5}\b/)?.[0]   // 21358 など4〜5桁
    ?? cleaned.match(/[A-Z]{2,}-?\d{3,}/)?.[0]         // SW-1234 など
    ?? cleaned.match(/\b[A-Z]\d{4,}\b/)?.[0];          // F4567 など

  // Step3: 残ワードから重複を除いて先頭から取る
  const words = cleaned.split(/\s+/).filter((w) => w.length >= 2);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(w); }
  }

  // 製品番号 + 先頭2ワード（製品番号と被らないもの）
  const result: string[] = [];
  if (numCode) result.push(numCode);
  for (const w of unique) {
    if (result.length >= 3) break;
    if (w === numCode) continue;
    result.push(w);
  }

  return result.join(" ");
}

// eBay販売実績（Sold Listings）検索URL
export function toEbaySoldUrl(keyword: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_Complete=1&LH_Sold=1`;
}

// メルカリ販売実績（売り切れ）検索URL
export function toMercariSoldUrl(keyword: string): string {
  return `https://jp.mercari.com/search?keyword=${encodeURIComponent(keyword)}&status=sold_out`;
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
