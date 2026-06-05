import { NextRequest } from "next/server";

// ========== キャッシュ（6時間TTL） ==========
const cache = new Map<string, { avgPrice: number | null; count: number; matched: boolean; expiresAt: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function getCached(key: string) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry;
}
function setCache(key: string, data: { avgPrice: number | null; count: number; matched: boolean }) {
  if (cache.size >= 1000) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  cache.set(key, { ...data, expiresAt: Date.now() + CACHE_TTL });
}

// ========== 型番・商品コード抽出 ==========
function extractProductCode(title: string): string[] {
  const patterns = [
    /[A-Z]{2,}-?\d{3,}/g,
    /\b[A-Z]\d{4,}[A-Z]?\b/g,
    /\b\d{4}-\d{4}\b/g,
    /(?:第\d+弾|Vol\.\d+|BOX\d*)/g,
    /\b\d{4,5}\b/g,
  ];
  const codes: string[] = [];
  for (const p of patterns) codes.push(...(title.match(p) ?? []));
  return [...new Set(codes)];
}

// ========== ヤフオク落札済み取得 ==========
async function getYahooAuctionSoldItems(keyword: string): Promise<Array<{ title: string; price: number }>> {
  try {
    const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(keyword)}&va=${encodeURIComponent(keyword)}&exflg=1&b=1&n=20&s1=cbids&o1=d&t=closed&mode=2`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.5",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const items: Array<{ title: string; price: number }> = [];

    // タイトルと落札価格を抽出
    // パターン1: data-auction-title と data-auction-price
    const titlePattern = /data-auction-title="([^"]+)"/g;
    const pricePattern = /data-auction-price="(\d+)"/g;

    const titles: string[] = [];
    const prices: number[] = [];

    let m;
    while ((m = titlePattern.exec(html)) !== null) titles.push(m[1]);
    while ((m = pricePattern.exec(html)) !== null) prices.push(parseInt(m[1]));

    if (titles.length > 0 && prices.length > 0) {
      const len = Math.min(titles.length, prices.length);
      for (let i = 0; i < len; i++) {
        if (prices[i] > 0) items.push({ title: titles[i], price: prices[i] });
      }
    }

    // パターン2: JSON-LD or structured data
    if (items.length === 0) {
      // 落札価格のテキストパターン
      const priceMatches = html.match(/(?:落札価格|現在価格)[^\d]*?([\d,]+)円/g) ?? [];
      const titleMatches = html.match(/<h3[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h3>/g) ?? [];

      for (let i = 0; i < Math.min(priceMatches.length, titleMatches.length); i++) {
        const priceStr = priceMatches[i].replace(/[^\d]/g, "");
        const title = titleMatches[i].replace(/<[^>]+>/g, "").trim();
        const price = parseInt(priceStr);
        if (price > 0 && title) items.push({ title, price });
      }
    }

    // パターン3: Linkタグからの抽出 (li要素内のテキスト)
    if (items.length === 0) {
      // 価格のみ抽出（タイトルなしでも平均計算に使用）
      const rawPrices = html.match(/(\d{3,6})円/g) ?? [];
      const nums = rawPrices
        .map((s) => parseInt(s.replace(/[^\d]/g, "")))
        .filter((n) => n >= 100 && n <= 1000000);
      if (nums.length > 0) {
        // タイトルなしの場合はキーワードをタイトルとして使用
        nums.forEach((p) => items.push({ title: keyword, price: p }));
      }
    }

    return items;
  } catch {
    return [];
  }
}

// ========== メインAPIハンドラー ==========
export async function POST(req: NextRequest) {
  const { rakutenTitle, rakutenPrice } = await req.json();

  if (!rakutenTitle) return Response.json({ matched: false, avgPrice: null, count: 0 });

  const cacheKey = `yahoo_${rakutenTitle.slice(0, 40)}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json({ ...cached, fromCache: true });

  // クリーンなタイトル生成
  const cleanTitle = rakutenTitle
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/送料無料|新品|未開封|未使用|正規品|セール|互換|風/g, "")
    .replace(/\s+/g, " ").trim();

  const codes = extractProductCode(cleanTitle);
  const words = cleanTitle.split(/\s+/).filter((w: string) => w.length >= 2);

  // 製品番号優先のキーワード生成（最大4語）
  const keyParts: string[] = [];
  if (codes[0]) keyParts.push(codes[0]);
  for (const w of words) {
    if (keyParts.length >= 4) break;
    if (w === codes[0]) continue;
    keyParts.push(w);
  }
  const searchKeyword = keyParts.join(" ");

  // ヤフオク落札済み取得
  let yahooItems = await getYahooAuctionSoldItems(searchKeyword);

  // リトライ（短縮キーワード）
  if (yahooItems.length === 0 && searchKeyword.includes(" ")) {
    const shorter = keyParts.slice(0, 2).join(" ");
    yahooItems = await getYahooAuctionSoldItems(shorter);
  }

  if (yahooItems.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // 価格フィルター（仕入れ価格の50%〜500%）
  const priceFiltered = yahooItems.filter(
    (item) => item.price >= rakutenPrice * 0.5 && item.price <= rakutenPrice * 5
  );

  if (priceFiltered.length === 0) {
    const result = { matched: false, avgPrice: null, count: 0 };
    setCache(cacheKey, result);
    return Response.json(result);
  }

  // 型番一致チェック
  let matched = priceFiltered;
  if (codes.length > 0) {
    const codeMatches = priceFiltered.filter((item) =>
      codes.some((code) => item.title.toUpperCase().includes(code.toUpperCase()))
    );
    if (codeMatches.length > 0) matched = codeMatches;
  }

  // タイトル類似度チェック（型番なし or 型番一致なしの場合）
  if (matched === priceFiltered) {
    const keyTokens = searchKeyword.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (keyTokens.length >= 2) {
      const titleMatches = priceFiltered.filter((item) => {
        const t = item.title.toLowerCase();
        const matchCount = keyTokens.filter((tok) => t.includes(tok)).length;
        return matchCount >= Math.ceil(keyTokens.length * 0.6);
      });
      if (titleMatches.length > 0) matched = titleMatches;
    }
  }

  // 外れ値除去して平均計算
  const prices = matched.map((i) => i.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const valid = prices.filter((p) => p >= median * 0.5 && p <= median * 2);
  const avgPrice = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);

  const result = { matched: true, avgPrice, count: valid.length };
  setCache(cacheKey, result);
  return Response.json(result);
}
