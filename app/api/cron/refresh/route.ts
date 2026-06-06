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

// ========== eBay Finding API: 売れた商品を取得 ==========
async function fetchEbaySoldItems(keyword: string): Promise<number[]> {
  const appId = process.env.EBAY_APP_ID;
  if (!appId || keyword.length < 3) return [];

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    "keywords": keyword,
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "itemFilter(1).name": "ListingType",
    "itemFilter(1).value": "FixedPrice",
    "sortOrder": "EndTimeSoonest",
    "paginationInput.entriesPerPage": "20",
    "outputSelector(0)": "SellerInfo",
  });

  try {
    const res = await fetch(
      `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
      { signal: AbortSignal.timeout(6000), cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];
    const prices: number[] = [];
    for (const item of items) {
      const priceStr = item?.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.["__value__"];
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        prices.push(Math.round(price * USD_TO_JPY));
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

  // 楽天商品を取得（人気ジャンルキーワードで幅広く）
  for (const keyword of SEARCH_KEYWORDS) {
    if (Date.now() - startedAt > 25_000) break; // 25秒でフェーズ1終了
    for (let page = 1; page <= 2; page++) {
      const items = await fetchRakutenPage(keyword, "-reviewCount", page);
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000 || seen.has(it.itemCode)) continue;
        seen.add(it.itemCode);
        rakutenProducts.push(it);
      }
      if (items.length < 30) break;
      await sleep(400);
    }
    await sleep(500);
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

    const prices = await fetchEbaySoldItems(enQuery);
    if (prices.length < 3) {
      await sleep(200);
      continue;
    }

    const result = calcRobustAverage(prices);
    if (!result) continue;

    const pointAmount = Math.floor(it.itemPrice * (it.pointRate ?? 1) / 100);
    const { profit, profitRate } = calcProfit(it.itemPrice, result.avg, pointAmount);

    // 利益率10%以上かつ利益¥500以上の商品のみ
    if (profit < 500 || profitRate < 10) {
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

    await sleep(300); // eBay APIレート制限対策
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
