import { kv } from "@vercel/kv";
import { ProfitProduct } from "../../../lib/profitFilter";

export const maxDuration = 60;

// ========== 定数 ==========
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID ?? "ba6c0bfe-08de-4163-bbb4-d118aaacabb0";
const RAKUTEN_ACCESS_KEY = "pk_NumikiUfx2PbTNjhKnw3O2HAf9XeSUO9KdEUsa9GmVD";
const RAKUTEN_AFFILIATE_ID = "548be677.8bfec03c.548be678.0aee6152";
const USD_TO_JPY = 155;
const EBAY_FEE_RATE = 0.1325; // 13.25%
const EBAY_FEE_FIXED_JPY = 47; // $0.30 ≈ ¥47
const SHIPPING_COST_JPY = 2500; // 平均国際送料

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ========== ブランド辞書 ==========
const BRAND_JP_TO_EN: Record<string, string> = {
  "任天堂": "Nintendo", "ニンテンドー": "Nintendo",
  "ソニー": "Sony", "プレイステーション": "PlayStation",
  "セガ": "Sega", "カプコン": "Capcom", "コナミ": "Konami",
  "バンダイ": "Bandai", "バンダイナムコ": "Bandai Namco",
  "スクウェアエニックス": "Square Enix", "スクエニ": "Square Enix",
  "レゴ": "LEGO", "タカラトミー": "Takara Tomy", "トミカ": "Tomica",
  "コトブキヤ": "Kotobukiya", "グッドスマイル": "Good Smile Company",
  "マックスファクトリー": "Max Factory", "アルター": "Alter",
  "メガハウス": "MegaHouse", "フリーイング": "FREEing",
  "ポケモン": "Pokemon", "ポケットモンスター": "Pokemon",
  "遊戯王": "Yu-Gi-Oh", "デュエルマスターズ": "Duel Masters",
  "ドラゴンボール": "Dragon Ball", "ナルト": "Naruto",
  "進撃の巨人": "Attack on Titan", "鬼滅の刃": "Demon Slayer",
  "呪術廻戦": "Jujutsu Kaisen", "エヴァンゲリオン": "Evangelion",
  "ガンダム": "Gundam", "ゴジラ": "Godzilla",
  "キヤノン": "Canon", "キャノン": "Canon",
  "ニコン": "Nikon", "フジフイルム": "Fujifilm", "フジフィルム": "Fujifilm",
  "オリンパス": "Olympus", "パナソニック": "Panasonic",
  "資生堂": "Shiseido", "花王": "Kao", "カネボウ": "Kanebo",
  "セイコー": "Seiko", "シチズン": "Citizen", "カシオ": "Casio",
  "初音ミク": "Hatsune Miku", "ねんどろいど": "Nendoroid",
  "ワンピース": "One Piece",
};

// eBay向け人気ジャンルのキーワード（楽天API検索用）
const SEARCH_KEYWORDS = [
  "ポケモンカード BOX", "遊戯王 BOX", "ガンプラ MG", "LEGO テクニック",
  "ねんどろいど", "Nintendo Switch", "フィギュア 限定", "セイコー 腕時計",
  "資生堂 アネッサ", "トミカ ギフト", "ワンピース カード", "鬼滅の刃 フィギュア",
  "ガンダム RG", "LEGO スターウォーズ", "ポケモン ぬいぐるみ",
];

// ========== 楽天商品取得 ==========
async function fetchRakutenPage(keyword: string, sort: string, page: number): Promise<any[]> {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    hits: "30",
    page: String(page),
    sort,
    format: "json",
    minPrice: "1000",
    keyword,
  });
  try {
    const res = await fetch(
      `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`,
      {
        headers: {
          "Referer": "https://resale-research-app.vercel.app/",
          "Origin": "https://resale-research-app.vercel.app",
          "User-Agent": "Mozilla/5.0",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    return (await res.json()).Items ?? [];
  } catch {
    return [];
  }
}

function buildCoreKeyword(title: string): string {
  return title
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    // セール・プロモーション文言を除去
    .replace(/今だけ[^　\s]*/g, "")
    .replace(/\d+[%％]OFF[^\s]*/g, "")
    .replace(/\d+月\d+日(発売|終了|まで)?/g, "")
    .replace(/送料無料/g, "")
    .replace(/[★☆◆◇●○■□▲△▼▽♪♥♡※〇]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

function parseImageUrl(urls: any): string {
  if (!urls) return "";
  if (Array.isArray(urls) && urls.length > 0) return urls[0]?.imageUrl ?? "";
  return "";
}

// ========== タイトルを英語クエリに変換 ==========
function toEnglishQuery(jpTitle: string): string {
  let result = jpTitle;
  // ブランド名を英語に置換
  for (const [jp, en] of Object.entries(BRAND_JP_TO_EN)) {
    result = result.replace(new RegExp(jp, "g"), en);
  }
  // 日本語文字（ひらがな・カタカナ・漢字）を除去
  result = result.replace(/[぀-ゟ゠-ヿ一-鿿＀-￯]/g, " ");
  // 記号除去、スペース正規化
  result = result.replace(/[^\w\s\-\.\/]/g, " ").replace(/\s+/g, " ").trim();
  // 長すぎる場合は最初の5単語まで
  const words = result.split(" ").filter(Boolean);
  return words.slice(0, 5).join(" ");
}

// ========== 型番・スケール等の構造化トークンを抽出 ==========
function extractStructuredTokens(text: string): string[] {
  const tokens: string[] = [];
  // スケール比（1/100, 1/144 等）
  const scales = text.match(/\d+\/\d+/g) ?? [];
  tokens.push(...scales);
  // 型番パターン（英字+数字の組み合わせ: HG, MG, RG, PG, SW-123 等）
  const modelNums = text.match(/\b[A-Za-z]{1,4}[-\s]?\d{2,6}\b|\b\d{2,6}[-\s]?[A-Za-z]{1,4}\b/g) ?? [];
  tokens.push(...modelNums.map(t => t.replace(/\s/g, "").toLowerCase()));
  // バージョン番号（Ver.2, v2 等）
  const versions = text.match(/\bv(?:er)?\.?\s*\d+\b/gi) ?? [];
  tokens.push(...versions.map(t => t.toLowerCase()));
  // 純粋な数字（3桁以上：製品番号として意味がある）
  const nums = text.match(/\b\d{3,}\b/g) ?? [];
  tokens.push(...nums);
  return tokens.filter(Boolean);
}

// ========== ①前方マッチ: クエリ単語 → eBayタイトル ==========
function forwardMatchScore(queryWords: string[], ebayTitle: string): number {
  if (queryWords.length === 0) return 0;
  const ebayLower = ebayTitle.toLowerCase();
  const matches = queryWords.filter(w => w.length >= 2 && ebayLower.includes(w.toLowerCase()));
  return matches.length / queryWords.length;
}

// ========== ④逆方向マッチ: eBayタイトルの重要語 → クエリ ==========
// eBayタイトルから意味のある英数字トークンを抽出し、それがクエリにどれだけ含まれるか
function reverseMatchScore(queryLower: string, ebayTitle: string): number {
  // eBayタイトルから意味のある単語（3文字以上の英字、または型番・数字）を抽出
  const ebayWords = ebayTitle
    .split(/\s+/)
    .filter(w => /^[A-Za-z]{3,}$/.test(w) || /[A-Za-z]\d|\d[A-Za-z]/.test(w) || /^\d{3,}$/.test(w))
    .map(w => w.toLowerCase())
    // 一般的なノイズワードを除外
    .filter(w => !["new", "the", "for", "and", "with", "set", "box", "lot", "sealed", "pack", "bag", "case"].includes(w));
  if (ebayWords.length === 0) return 0;
  const matches = ebayWords.filter(w => queryLower.includes(w));
  return matches.length / ebayWords.length;
}

// ========== 構造トークンの完全一致ボーナス ==========
// 型番・スケールが一致すれば信頼度大幅アップ
function structuredTokenBonus(queryText: string, ebayTitle: string): number {
  const qTokens = extractStructuredTokens(queryText);
  const eTokens = extractStructuredTokens(ebayTitle.toLowerCase());
  if (qTokens.length === 0) return 0;
  const matches = qTokens.filter(t => eTokens.some(e => e === t.toLowerCase()));
  return matches.length > 0 ? matches.length / qTokens.length : 0;
}

// ========== 総合マッチスコア（①＋④＋構造トークン）==========
function combinedMatchScore(queryWords: string[], queryLower: string, ebayTitle: string): number {
  const forward = forwardMatchScore(queryWords, ebayTitle);        // ①
  const reverse = reverseMatchScore(queryLower, ebayTitle);        // ④
  const structured = structuredTokenBonus(queryLower, ebayTitle); // 型番完全一致
  // 構造トークンが一致していれば即合格（型番が合えば同一商品の確度高）
  if (structured >= 0.5) return 1.0;
  // 前方・逆方向の加重平均（前方重視）
  return forward * 0.6 + reverse * 0.4;
}

// ========== eBay OAuth トークン取得（メモリキャッシュ） ==========
let ebayTokenCache: { token: string; expiresAt: number } | null = null;

async function getEbayToken(): Promise<string | null> {
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CLIENT_SECRET;
  if (!appId || !certId) return null;

  // キャッシュが有効なら再利用
  if (ebayTokenCache && Date.now() < ebayTokenCache.expiresAt) {
    return ebayTokenCache.token;
  }

  const encoded = Buffer.from(`${appId}:${certId}`).toString("base64");
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${encoded}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data.access_token as string;
    const expiresIn = (data.expires_in as number) ?? 7200;
    ebayTokenCache = { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
    return token;
  } catch {
    return null;
  }
}

// ========== eBay Browse API: 出品価格を取得しタイトル類似度でフィルタリング ==========
async function fetchEbayMatchedPrices(keyword: string): Promise<number[]> {
  if (keyword.length < 3) return [];
  const token = await getEbayToken();
  if (!token) return [];

  // クエリの単語リスト（類似度判定用）
  const queryWords = keyword.split(/\s+/).filter(w => w.length >= 2);
  const queryLower = keyword.toLowerCase();
  // 意味のある英語単語（ブランド名・型番・数字）が1つ以上なければスキップ
  const meaningfulWords = queryWords.filter(w => /[A-Za-z0-9]{2,}/.test(w));
  if (meaningfulWords.length === 0) return [];

  const params = new URLSearchParams({
    q: keyword,
    filter: "buyingOptions:{FIXED_PRICE},conditions:{NEW|LIKE_NEW}",
    sort: "bestMatch",
    limit: "20",
    fieldgroups: "COMPACT",
  });

  try {
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items: any[] = data?.itemSummaries ?? [];
    const prices: number[] = [];
    for (const item of items) {
      // ①+④ 総合マッチスコア：0.35以上で合格
      const score = combinedMatchScore(queryWords, queryLower, item?.title ?? "");
      if (score < 0.35) continue;

      const price = parseFloat(item?.price?.value);
      const currency = item?.price?.currency;
      if (!isNaN(price) && price > 0) {
        if (currency === "USD") {
          prices.push(Math.round(price * USD_TO_JPY));
        } else if (currency === "JPY") {
          prices.push(Math.round(price));
        }
      }
    }
    return prices;
  } catch {
    return [];
  }
}

// ========== IQR法で外れ値除去し平均を返す ==========
function calcRobustAverage(prices: number[]): { avg: number; count: number } | null {
  if (prices.length < 3) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const valid = sorted.filter((p) => p >= lower && p <= upper);
  if (valid.length === 0) return null;
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  return { avg, count: valid.length };
}

// ========== 利益計算 ==========
function calcProfit(rakutenPrice: number, ebayAvgJpy: number, pointAmount: number) {
  const effectiveBuyPrice = rakutenPrice - pointAmount; // ポイント分を引く
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuyPrice - ebayFee - SHIPPING_COST_JPY;
  const profitRate = Math.round((profit / effectiveBuyPrice) * 100);
  return { profit, profitRate };
}

// ========== カテゴリ推定 ==========
function guessCategory(title: string): string {
  if (/ポケモン|遊戯王|デュエルマスターズ|トレカ|カード/i.test(title)) return "トレカ";
  if (/ガンプラ|ガンダム|HG|MG|RG|PG|1\/100|1\/144/i.test(title)) return "ガンプラ";
  if (/LEGO|レゴ/i.test(title)) return "LEGO";
  if (/フィギュア|ねんどろいど|Nendoroid|figma|プライズ/i.test(title)) return "フィギュア";
  if (/Nintendo Switch|ニンテンドースイッチ|PS5|PS4|Xbox/i.test(title)) return "ゲーム機";
  if (/ソフト|ゲーム|アミーボ|amiibo/i.test(title)) return "ゲーム";
  if (/腕時計|時計|Watch|Seiko|Citizen|Casio/i.test(title)) return "腕時計";
  if (/カメラ|レンズ|Canon|Nikon|Fujifilm|Olympus/i.test(title)) return "カメラ";
  if (/コスメ|化粧|美容|スキンケア|資生堂|花王/i.test(title)) return "コスメ";
  if (/トミカ|プラレール|おもちゃ|玩具/i.test(title)) return "おもちゃ";
  if (/アニメ|manga|マンガ|漫画/i.test(title)) return "アニメ";
  return "その他";
}

// ========== メインハンドラ ==========
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const seen = new Set<string>();
  const rakutenProducts: any[] = [];

  // 楽天商品を取得（人気ジャンルキーワード、1ページのみ）
  for (const keyword of SEARCH_KEYWORDS) {
    if (Date.now() - startedAt > 15_000) break; // 15秒でフェーズ1終了
    const items = await fetchRakutenPage(keyword, "-reviewCount", 1);
    for (const raw of items) {
      const it = raw.Item;
      if (!it || it.itemPrice < 1000 || seen.has(it.itemCode)) continue;
      seen.add(it.itemCode);
      rakutenProducts.push(it);
    }
    await sleep(300);
  }

  // eBay APIキーが未設定の場合は楽天商品だけ保存して終了
  if (!process.env.EBAY_APP_ID) {
    await kv.set("rakuten_products", rakutenProducts.slice(0, 200), { ex: 60 * 60 * 14 });
    await kv.set("last_updated", new Date().toISOString());
    return Response.json({
      ok: true,
      mode: "rakuten-only (EBAY_APP_ID not set)",
      rakutenCount: rakutenProducts.length,
      elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    });
  }

  // eBay比較 → 利益商品抽出
  const profitableProducts: ProfitProduct[] = [];
  // 残り時間を考慮しながら処理（最大35秒使う）
  for (const it of rakutenProducts) {
    if (Date.now() - startedAt > 52_000) break; // 52秒でeBayループ終了

    const coreKw = buildCoreKeyword(it.itemName);
    const enQuery = toEnglishQuery(it.itemName);
    if (!enQuery || enQuery.length < 3) continue;

    const prices = await fetchEbayMatchedPrices(enQuery);
    if (prices.length < 3) {
      await sleep(200);
      continue;
    }

    const result = calcRobustAverage(prices);
    if (!result) continue;

    const pointAmount = Math.floor(it.itemPrice * (it.pointRate ?? 1) / 100);
    const { profit, profitRate } = calcProfit(it.itemPrice, result.avg, pointAmount);

    // 利益率10%以上・利益¥500以上・利益率500%以下（異常マッチを除外）
    if (profit < 500 || profitRate < 10 || profitRate > 500) {
      await sleep(200);
      continue;
    }

    profitableProducts.push({
      id: it.itemCode,
      title: it.itemName,
      imageUrl: parseImageUrl(it.mediumImageUrls) || parseImageUrl(it.smallImageUrls),
      category: guessCategory(it.itemName),
      source: {
        site: "rakuten",
        siteName: "楽天",
        price: it.itemPrice,
        url: it.affiliateUrl || it.itemUrl,
        pointRate: it.pointRate ?? 1,
        pointAmount,
      },
      isNew: (it.itemName ?? "").includes("新品") || (it.itemName ?? "").includes("未開封"),
      coreKeyword: coreKw,
      ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(enQuery)}&LH_Complete=1&LH_Sold=1`,
      realAvgPrice: result.avg,
      realProfit: profit,
      realProfitRate: profitRate,
      realCount: result.count,
    });

    await sleep(200); // eBay APIレート制限対策
  }

  // 利益率降順でソートして保存
  profitableProducts.sort((a, b) => b.realProfitRate - a.realProfitRate);
  const top50 = profitableProducts.slice(0, 50);

  await kv.set("profitable_products", top50, { ex: 60 * 60 * 16 });
  await kv.set("last_updated", new Date().toISOString());

  return Response.json({
    ok: true,
    mode: "full (Rakuten + eBay)",
    rakutenCount: rakutenProducts.length,
    profitableCount: profitableProducts.length,
    savedCount: top50.length,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
  });
}
