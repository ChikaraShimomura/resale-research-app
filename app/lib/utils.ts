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


const EBAY_LISTING_BASE: Record<string, string> = {
  EBAY_US: "https://www.ebay.com/sl/list",
  EBAY_GB: "https://www.ebay.co.uk/sl/list",
  EBAY_AU: "https://www.ebay.com.au/sl/list",
};

// 市場別の為替レート・送料設定
const MARKET_CONFIG: Record<string, { rate: number; shipping: number }> = {
  EBAY_US: { rate: 155, shipping: 25   }, // USD
  EBAY_GB: { rate: 197, shipping: 18   }, // GBP
  EBAY_AU: { rate: 100, shipping: 30   }, // AUD
};

// タイトルから新品/中古を判定してeBay conditionId を返す
function detectConditionId(title: string): string {
  const t = title.toLowerCase();
  if (/新品|未開封|未使用|sealed|brand new/.test(t)) return "1000"; // New
  if (/中古|used|junk|難あり/.test(t)) return "3000";               // Used
  return "1000"; // デフォルトは新品
}

export function toEbayListingUrl(
  title: string,
  market?: string,
  ebayAvgJpy?: number,
): string {
  const m = market ?? "EBAY_US";
  const config = MARKET_CONFIG[m] ?? MARKET_CONFIG.EBAY_US;
  const base   = EBAY_LISTING_BASE[m] ?? EBAY_LISTING_BASE.EBAY_US;

  const cleaned = title
    .replace(/【[^】]*】/g, "")
    .replace(/[^\x00-\x7F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const q = encodeURIComponent(cleaned || title.slice(0, 80));

  const params = new URLSearchParams({ title: cleaned || title.slice(0, 80) });

  // 出品価格（平均落札価格を現地通貨に変換）
  if (ebayAvgJpy && ebayAvgJpy > 0) {
    const price = Math.ceil(ebayAvgJpy / config.rate);
    params.set("price", String(price));
  }

  // 送料（買い手負担・固定）
  params.set("shipping", String(config.shipping));

  // コンディション
  params.set("conditionId", detectConditionId(title));

  return `${base}?${params.toString()}`;
}

