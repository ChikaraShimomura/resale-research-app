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

// 楽天タイトルからノイズを除去してコアキーワードを抽出（精度重視版）
export function extractCoreKeyword(title: string): string {
  // Step1: ノイズ除去
  let cleaned = title
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/[★☆◆◇●○■□▲△▼▽♪♥♡※〇]/g, "")
    .replace(/送料無料|送料込|新品|未開封|未使用|正規品|国内正規|日本正規|セール|特典付き?|プレゼント|ギフト|包装|ラッピング|代引き?不可|あす楽|即日発送|在庫あり|お買い得|お得|激安|大人気/g, "")
    .replace(/\d+個セット|\d+枚セット|\d+本セット|\d+点セット|\d+体セット|\d+冊セット/g, "")
    .replace(/互換|風|もどき/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Step2: 型番・品番を最優先で抽出
  const codePatterns = [
    /[A-Z]{2,}-?\d{3,}/g,        // SW-1234, SV1S
    /\b[A-Z]\d{4,}[A-Z]?\b/g,   // F4567A
    /\b\d{4}-\d{4}\b/g,          // 1234-5678
    /(?:第\d+弾|Vol\.\d+)/g,     // 第3弾, Vol.2
    /No\.\d+/ig,                  // No.123
  ];
  const codes: string[] = [];
  for (const pat of codePatterns) {
    const m = cleaned.match(pat);
    if (m) codes.push(...m);
  }

  // Step3: ブランド・シリーズ名を抽出（英数字混在ワード優先）
  const words = cleaned.split(/[\s　]+/).filter(Boolean);

  // 英字を含むワードを優先（ブランド名・型番が多い）
  const brandWords = words.filter((w) => /[A-Za-z]/.test(w) && w.length >= 2);
  // 日本語ワード（短すぎるものは除外）
  const jpWords = words.filter((w) => !/[A-Za-z]/.test(w) && w.length >= 2 && !/^\d+$/.test(w));

  // 組み合わせ: 型番 > 英字ブランド > 日本語ワード
  const priority: string[] = [];
  if (codes.length > 0) priority.push(codes[0]);
  priority.push(...brandWords.slice(0, 2));
  priority.push(...jpWords.slice(0, 2));

  // 重複除去して最大3ワード
  const unique = [...new Set(priority)].slice(0, 3);
  return unique.length > 0 ? unique.join(" ") : words.slice(0, 3).join(" ");
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
