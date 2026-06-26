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

// 時計の日本語モデル名→eBay英語表記（出品者が実際に使う語）。ハードオフの型番(code)だけだとeBayで0件になるため、
// ライン名でフォールバックして「その機種に近い実落札」を必ず出す＝根拠ボタンが空にならない。
const WATCH_LINE: [RegExp, string][] = [
  [/オシアナス|OCEANUS/i, "Oceanus"], [/プロマスター|PROMASTER/i, "Promaster"], [/アテッサ|ATTESA/i, "Attesa"],
  [/プレザージュ|PRESAGE/i, "Presage"], [/プロスペックス|PROSPEX/i, "Prospex"], [/プロトレック|PRO\s?TREK/i, "Pro Trek"],
  [/エディフィス|EDIFICE/i, "Edifice"], [/オリエント\s?スター|ORIENT\s?STAR/i, "Orient Star"],
  [/Gショック|G-?SHOCK/i, "G-Shock"], [/アルピニスト|ALPINIST/i, "Alpinist"], [/バンビーノ|BAMBINO/i, "Bambino"],
  [/セイコー\s?5|SEIKO\s?5|5スポーツ|5SPORTS/i, "Seiko 5"], [/アストロン|ASTRON/i, "Astron"],
  [/ルキア|LUKIA/i, "Lukia"], [/ドルチェ|DOLCE/i, "Dolce"], [/ツヨサ|TSUYOSA/i, "Tsuyosa"],
  [/カマス|KAMASU/i, "Kamasu"], [/マコ\b|MAKO/i, "Mako"], [/ダイバー|DIVER/i, "diver"],
];
function watchLine(text: string): string {
  for (const [re, en] of WATCH_LINE) if (re.test(text)) return en;
  return "";
}

// eBayの落札（Sold/Completed）検索URL＝「eBay落札を確認」ボタンのリンク先。
// ライン名が分かれば ブランド+ライン名（必ず結果が出る）、無ければ ブランド+型番、最後に ブランド+商品名。
// ※型番リファイナが ebaySoldUrl をセット済みの確定品は、UI側でそちら（実際に落札が返ったクエリ）を優先する。
export function ebaySoldSearchUrl(p: { brand?: string; code?: string; name?: string; modelKey?: string }): string {
  const line = watchLine(`${p.name || ""} ${p.code || ""} ${p.modelKey || ""}`);
  const q =
    (line ? [p.brand, line].filter(Boolean).join(" ") : "") ||
    [p.brand, p.code].filter(Boolean).join(" ").trim() ||
    [p.brand, p.name].filter(Boolean).join(" ").trim();
  // LH_ItemCondition=3000 ＝ 中古(Used/Pre-owned)のみ。新品が混ざるのを防ぐ。
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q.replace(/\s+/g, " ").trim())}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;
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

// 仕入れ元サイトの表示名。site値("hardoff"/"2ndstreet")→ユーザー向け名称。新サイト追加時はここに足す。
export function sourceSiteName(site: string | undefined | null): string {
  switch (site) {
    case "2ndstreet": return "2nd STREET";
    case "hardoff": return "ハードオフ";
    default: return "中古サイト";
  }
}

// 状態ランクの表示（ランク文字＋意味＋色）。ハードオフ=N/S/A/B/C/D/JUNK、2nd ST=「中古C」等の両方を解釈。
export function conditionLabel(c: string | null): { rank: string; label: string; tone: "good" | "mid" | "risk" } {
  const raw = (c || "").toUpperCase();
  let rank = "";
  if (/JUNK|ジャンク/.test(raw)) rank = "JUNK";
  else if (/新品|未使用/.test(raw)) rank = "N";
  else { const m = raw.match(/(?:中古)?\s*([NSABCD])\b/); rank = m ? m[1] : ""; }
  // ラベルは「状態が一目で分かる言葉」にする（極上/美品/並のような業界用語は避ける）。
  switch (rank) {
    case "N": return { rank: "N", label: "新品同様", tone: "good" };
    case "S": return { rank: "S", label: "ほぼ新品", tone: "good" };
    case "A": return { rank: "A", label: "目立つ傷なし", tone: "good" };
    case "B": return { rank: "B", label: "普通の使用感", tone: "mid" };
    case "C": return { rank: "C", label: "傷・使用感あり", tone: "mid" };
    case "D": return { rank: "D", label: "難あり", tone: "risk" };
    case "JUNK": return { rank: "JUNK", label: "ジャンク(動作未確認)", tone: "risk" };
    default: return { rank: "", label: "中古", tone: "mid" };
  }
}

// ジャンク(動作未確認/部品取り)判定。eBay相場は「動く品」基準なのでカタログから除外する。
export function isJunk(c?: string | null): boolean {
  return /JUNK|ジャンク/i.test(c || "");
}

// カタログ商品の安定キー（per-actorの「仕入れた/これは無理」印の保存キー）。idがあればid、無ければ仕入れURL。
export function catalogItemKey(p: { id?: string; hardoffUrl: string }): string {
  return p.id || p.hardoffUrl;
}

// このアクターが「仕入れた」or「これは無理」で外した商品キーの集合。カタログ/ランキングの表示から差し引く。
// 書き込みは /api/catalog/action（used_bought:{actor}=id→仕入れ値ハッシュ / used_skip:{actor}=id集合）。読みは read-only。
export async function getHiddenCatalogKeys(actor: string | undefined | null): Promise<Set<string>> {
  if (!actor) return new Set();
  try {
    const [boughtIds, skip] = await Promise.all([
      kvReadOnly.hkeys(`used_bought:${actor}`),
      kvReadOnly.smembers(`used_skip:${actor}`),
    ]);
    return new Set<string>([...(boughtIds ?? []), ...(skip ?? [])] as string[]);
  } catch {
    return new Set();
  }
}

// 「仕入れた」商品のスナップショット＝出品用 ProfitProduct ＋ 仕入れ値/仕入れ日。一覧表示＆eBay出品に使う。
export type BoughtItem = ProfitProduct & { buyJpy?: number; boughtAt?: string };

// このアクターが「仕入れた」品の一覧（新しい順）。値は /api/catalog/action が psnap から焼いたスナップショット。
// 旧形式（数値だけ・スナップショット無し）はカードを描けないので除外する。
export async function getBoughtItems(actor: string | undefined | null): Promise<BoughtItem[]> {
  if (!actor) return [];
  try {
    const map = await kvReadOnly.hgetall<Record<string, BoughtItem>>(`used_bought:${actor}`);
    if (!map) return [];
    return Object.values(map)
      .filter((x): x is BoughtItem => !!x && typeof x === "object" && !!x.id && !!x.title)
      .sort((a, b) => String(b.boughtAt || "").localeCompare(String(a.boughtAt || "")));
  } catch {
    return [];
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
