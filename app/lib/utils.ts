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
// eBay相場の検索URL。eBayタイトルは長く特定的すぎて、そのまま検索すると
// 0件→無関係な「関連商品」が表示される。ブランド+商品名の主要数語に絞り、
// さらに「表示中のeBay金額(_udlo=最低価格フロア)」未満の出品は出さないようにする。
const EBAY_SEARCH_BASE: Record<string, string> = {
  EBAY_US: "https://www.ebay.com/sch/i.html",
  EBAY_GB: "https://www.ebay.co.uk/sch/i.html",
  EBAY_AU: "https://www.ebay.com.au/sch/i.html",
};

// _udlo はそのマーケットの通貨で指定する必要があるため、JPY→現地通貨に換算する。
// 換算レートは refresh.mjs の定数（USD155/GBP197/AUD100）と一致させること。
const EBAY_FX_RATE: Record<string, number> = { EBAY_US: 155, EBAY_GB: 197, EBAY_AU: 100 };

// 検索を絞りすぎる「状態・発送・宣伝」系のノイズ語。商品名(figure/box/card等)は残す。
const EBAY_NOISE_WORDS =
  /\b(new|sealed|unopened|opened|mint|nib|misb|bnib|preowned|pre-owned|used|official|authentic|genuine|japan|japanese|jp|import|imported|version|ver|limited|edition|exclusive|free|shipping|fast|tracking|rare|htf|lot|with|for|from|the|and|of|in|brand|preorder|pre-order)\b/gi;

// avgPriceJpy: 表示中の eBay 金額(JPY)。これ未満の出品を _udlo フロアで除外する。
export function toEbayMarketUrl(keyword: string, avgPriceJpy?: number, market?: string): string {
  const mk = market && EBAY_SEARCH_BASE[market] ? market : "EBAY_US";
  const base = EBAY_SEARCH_BASE[mk];
  const words = (keyword || "")
    .replace(/【[^】]*】/g, " ")
    .replace(/[^\x00-\x7F]/g, " ")           // 日本語など非ASCIIを除去
    .replace(/[^A-Za-z0-9#./\s-]/g, " ")     // 残った記号を空白に
    .replace(EBAY_NOISE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);                            // 主要6語に絞って広めに当てる
  const q = words.join(" ") || (keyword || "").slice(0, 40);
  const params = new URLSearchParams({ _nkw: q });
  // 表示中のeBay金額を下回る出品はリンク先に出さない（フロア＝表示額を現地通貨に換算）
  if (avgPriceJpy && avgPriceJpy > 0) {
    const floor = Math.round(avgPriceJpy / (EBAY_FX_RATE[mk] ?? 155));
    if (floor > 0) params.set("_udlo", String(floor));
  }
  return `${base}?${params.toString()}`;
}

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

