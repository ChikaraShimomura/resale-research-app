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


// eBay相場の検索URL。eBayタイトルは長く特定的すぎて、そのまま検索すると0件→無関係な
// 「関連商品」が並ぶ。ブランド+商品名の主要数語に絞りつつ、型番・カード番号・容量などの
// 「識別子」は必ず残して、検索結果の上位に “同じ商品そのもの” が出るようにする。
const EBAY_SEARCH_BASE: Record<string, string> = {
  EBAY_US: "https://www.ebay.com/sch/i.html",
  EBAY_GB: "https://www.ebay.co.uk/sch/i.html",
  EBAY_AU: "https://www.ebay.com.au/sch/i.html",
};

// 検索を絞りすぎる「状態・発送・宣伝」系のノイズ語。商品名(figure/box/card等)は残す。
const EBAY_NOISE_WORDS =
  /\b(new|sealed|unopened|opened|mint|nib|misb|bnib|preowned|pre-owned|used|official|authentic|genuine|japan|japanese|jp|import|imported|version|ver|limited|edition|exclusive|free|shipping|fast|tracking|rare|htf|lot|with|for|from|the|and|of|in|brand|preorder|pre-order)\b/gi;

// 数字を含む、または英字+ハイフンの符号（P-028 / DW-5600E / NVL-C-AEAA / 2004 / 150ml 等）は
// 商品を一意に決める識別子。6語制限で切り捨てると別の変種が並ぶため、検索語に必ず含める。
const isIdToken = (t: string) => /\d/.test(t) || /[A-Za-z].*-.*[A-Za-z0-9]/.test(t);

export function toEbayMarketUrl(keyword: string, market?: string): string {
  const mk = market && EBAY_SEARCH_BASE[market] ? market : "EBAY_US";
  const base = EBAY_SEARCH_BASE[mk];
  const tokens = (keyword || "")
    .replace(/【[^】]*】/g, " ")
    .replace(/[^\x00-\x7F]/g, " ")           // 日本語など非ASCIIを除去
    .replace(/[^A-Za-z0-9#./\s-]/g, " ")     // 残った記号を空白に
    .replace(EBAY_NOISE_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  // 名前語(最大4)＋識別子(最大2)。識別子を必ず残すことで「同じ商品」が上位に出る。
  // 価格フロア(_udlo)は付けない：実物が表示相場より安いと隠れてしまい逆効果だったため。
  const ids = tokens.filter(isIdToken).slice(0, 2);
  const names = tokens.filter((t) => !isIdToken(t)).slice(0, 4);
  const picked = [...names, ...ids];
  const q = (picked.length ? picked : tokens.slice(0, 6)).join(" ") || (keyword || "").slice(0, 40);
  return `${base}?${new URLSearchParams({ _nkw: q }).toString()}`;
}

