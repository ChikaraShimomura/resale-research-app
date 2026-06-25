import { kvReadOnly } from "./kv";
import type { ProfitProduct } from "./profitFilter";

// 【中古利益カタログ】eBay起点→中古サイト(ハードオフ等)照合→利益判定で作る「儲かる型番」エントリ。
// buildUsedSampleFromCache.mjs(住宅IPワーカー)が KV `used_catalog` に書き、ここで読み出す。
// ⚠️ 旧モデル(楽天新品の ProfitProduct)とは別系統。中古は1点物なので「型番」を主役に扱う。
export type UsedCatalogItem = {
  id?: string; // 出品フロー用の安定ID（psnap:{id} と対応）。buildが付与。
  modelKey: string; // 型番 or 商品名(同型の束ねキー)
  brand: string;
  name: string;
  code: string; // 型番(eBay照合に強い)
  cat: string; // ジャンル（音響/カメラ/楽器/ホビー/古着/時計…）
  ebayMedianJpy: number; // eBay中古落札の中央値(想定売値)
  buyJpy: number; // 中古サイトの現在価格(仕入れ値)
  condition: string | null; // 状態ランク N/S/A/B/C/D or JUNK
  profitJpy: number; // 送料/関税/手数料後の純利益
  profitRate: number; // 純利益率(%)
  hardoffUrl: string; // 仕入れ元の商品URL（リンクのみ＝再ホストしない）
  imageUrl: string; // 仕入れ元の画像URL（リンク参照）
  site: string; // "hardoff" など
  soldCount?: number; // 直近の落札件数（実需シグナル）。型番単位なら同一機種の件数。
  ebayConfirmed?: boolean; // true=型番単位でeBay落札相場を取得済み。false/未定義=系列中央値の「目安」。
  ebaySoldUrl?: string; // 代表落札ページ（型番リファイナが入れる・任意）
};

// eBayの落札（Sold/Completed）検索URL＝「根拠を確認」ボタンのリンク先。
// ブランド+型番(code)が最強（eBayは英語市場なので型番=言語非依存が効く）。型番が無ければ ブランド+商品名。
export function ebaySoldSearchUrl(p: { brand?: string; code?: string; name?: string }): string {
  const q =
    [p.brand, p.code].filter(Boolean).join(" ").trim() ||
    [p.brand, p.name].filter(Boolean).join(" ").trim();
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13`;
}

// 中古カタログ品 → eBay自動出品フロー(ListingHelper/EbayListingModal)に渡す ProfitProduct へ変換。
// 実データは build が psnap:{id} に書いておくので、prepare/publish は productId(=id) でそれを引いて出品する。
// ここで返すのはモーダル初期表示＋ id の橋渡し用（軽量）。仕入れ先は中古サイト、想定売値=eBay落札中央値。
export function toListingProduct(p: UsedCatalogItem): ProfitProduct {
  const siteName = p.site === "2ndstreet" ? "2nd STREET" : "ハードオフ";
  return {
    id: p.id || p.hardoffUrl,
    title: `${p.brand} ${p.name}`.trim(),
    imageUrl: p.imageUrl,
    images: p.imageUrl ? [p.imageUrl] : [],
    category: p.cat || "腕時計",
    coreKeyword: [p.brand, p.code].filter(Boolean).join(" ").trim(),
    realAvgPrice: p.ebayMedianJpy,
    realMedianPrice: p.ebayMedianJpy,
    realProfit: p.profitJpy,
    realProfitRate: p.profitRate,
    realCount: p.soldCount || 1,
    soldBased: !!p.ebayConfirmed,
    soldCount30d: p.soldCount,
    source: { site: p.site, siteName, price: p.buyJpy, url: p.hardoffUrl },
  } as unknown as ProfitProduct;
}

// 状態ランクの表示ラベルと色（eBay輸出での扱いやすさ順）。
export function conditionLabel(c: string | null): { label: string; tone: "good" | "mid" | "risk" } {
  switch ((c || "").toUpperCase()) {
    case "N": return { label: "新品同様", tone: "good" };
    case "S": return { label: "極上", tone: "good" };
    case "A": return { label: "美品", tone: "good" };
    case "B": return { label: "並", tone: "mid" };
    case "C": return { label: "使用感", tone: "mid" };
    case "D": return { label: "難あり", tone: "risk" };
    case "JUNK": return { label: "ジャンク", tone: "risk" };
    default: return { label: "中古", tone: "mid" };
  }
}

// KVから中古カタログを読む（読み取り専用トークン）。型番DB＝中古はモデル単位で見る。
export async function getUsedCatalog(): Promise<UsedCatalogItem[]> {
  try {
    const arr = await kvReadOnly.get<UsedCatalogItem[]>("used_catalog");
    if (!Array.isArray(arr)) return [];
    // 利益額の高い順（書込側でソート済みだが配信時も保証）。
    return arr.filter((x) => x && typeof x.profitJpy === "number").sort((a, b) => b.profitJpy - a.profitJpy);
  } catch {
    return [];
  }
}
