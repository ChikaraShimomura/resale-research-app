import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const RAKUTEN_AFFILIATE_ID = "1dd48768.9ee55924.1dd48769.68843b7c";

// http/https のURLのみ許可。javascript:/data: 等のスキームは空文字を返す（DOM-XSS対策）。
// スクレイピング由来の値が href/src に入るため全ての外部リンクをこれでゲートする。
export function safeHttpUrl(url: string | undefined | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

export function toRakutenAffiliateUrl(productUrl: string): string {
  const safe = safeHttpUrl(productUrl);
  if (!safe) return "";
  const encoded = encodeURIComponent(safe);
  return `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_AFFILIATE_ID}/?pc=${encoded}&link_type=text`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatJpy(amount: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(amount);
}


// eBayの出品開始ページ（prelist/suggest）— title をプレフィルできる唯一の入口。
// /sl/list はサインインに飛ばされる。q= や query= は無視されるため title= を使う。
const EBAY_PRELIST_BASE: Record<string, string> = {
  EBAY_US: "https://www.ebay.com/sl/prelist/suggest",
  EBAY_GB: "https://www.ebay.co.uk/sl/prelist/suggest",
  EBAY_AU: "https://www.ebay.com.au/sl/prelist/suggest",
};

// eBayの「出品をはじめる」画面へタイトルをプレフィルして遷移するURLを生成。
// eBayはURLでの価格・送料・コンディションのプレフィルを公式にサポートしていないため
// （Sell APIが必要）、title パラメータのみを渡す。
export function toEbayListingUrl(title: string, market?: string): string {
  const base = EBAY_PRELIST_BASE[market ?? "EBAY_US"] ?? EBAY_PRELIST_BASE.EBAY_US;

  const cleaned = title
    .replace(/【[^】]*】/g, "")
    .replace(/[^\x00-\x7F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const params = new URLSearchParams({ title: cleaned || title.slice(0, 80) });
  return `${base}?${params.toString()}`;
}

