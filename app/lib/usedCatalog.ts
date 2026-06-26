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
// ⚠️ eBay検索で "-" は「除外(NOT)演算子」扱い＝型番の "-" をそのまま入れると "-XXXX" 以降が除外され該当落札が出ない。
//    そのため型番の "-" は空白に置換してから検索する（照合側 norm は元から記号無視なので整合する）。
//    "-"空白化で型番がちゃんと効くようになったので、ライン名フォールバックより「型番」を優先＝特定型番の落札を出す。
export function ebaySoldSearchUrl(p: { brand?: string; code?: string; name?: string; modelKey?: string }): string {
  const code = (p.code || "").replace(/-/g, " ").replace(/\s+/g, " ").trim(); // 型番の "-"→空白（eBayの除外演算子回避）
  const line = watchLine(`${p.name || ""} ${p.code || ""} ${p.modelKey || ""}`);
  const q =
    [p.brand, code].filter(Boolean).join(" ").trim() ||        // 型番(ハイフン空白化)を最優先＝特定型番の落札
    (line ? [p.brand, line].filter(Boolean).join(" ") : "") || // 型番が無い時はライン名
    [p.brand, p.name].filter(Boolean).join(" ").trim();
  // LH_ItemCondition=3000 ＝ 中古(Used/Pre-owned)のみ。新品が混ざるのを防ぐ。
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q.replace(/\s+/g, " ").trim())}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;
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

// ジャンク(動作未確認/部品取り)判定。※2026-06-27 ユーザー指示でカタログ掲載は許可（除外しない）。状態ランク表示＋出品説明で明示。
export function isJunk(c?: string | null): boolean {
  return /JUNK|ジャンク/i.test(c || "");
}

// 発送不可（航空危険物・国際郵便不可）の判定＝配信からも除外する（buildの ebayQueries.PROHIBITED_EXCLUDE と同種・二重ガード）。
// ※.mjs/TSの境界でSSOT共有が難しいため要点を二重管理。新ジャンル追加時はこちらも見直す。
const PROHIBITED =
  /香水|フレグランス|オードトワレ|オーデコロン|パフューム|perfume|cologne|fragrance|eau de|スプレー缶|エアゾール|エアゾル|ヘアスプレー|制汗スプレー|殺虫スプレー|aerosol|モバイルバッテリー|リチウムイオンバッテリー|power\s?bank|ライター|チャッカマン|\blighter\b|花火|火薬|爆竹|firework|カセットボンベ|ガスボンベ|gas\s?canister|マニキュア|除光液|ネイルリムーバー|nail\s?polish|消毒用アルコール|エタノール|医薬品|劇薬|農薬/i;
export function isProhibited(text: string | null | undefined): boolean {
  return PROHIBITED.test(text || "");
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

// 「仕入れた」商品のスナップショット＝出品用 ProfitProduct ＋ 仕入れ値/仕入れ日/送料。一覧表示＆eBay出品に使う。
// shippingJpy は別ハッシュ used_ship:{actor} 由来（未設定は一律1000）。仕入れ原価＝buyJpy + shippingJpy。
export type BoughtItem = ProfitProduct & { buyJpy?: number; boughtAt?: string; shippingJpy?: number };
export const DEFAULT_SHIP_JPY = 1000; // 送料未設定時の一律値

// このアクターが「仕入れた」品の一覧（新しい順）。値は /api/catalog/action が psnap から焼いたスナップショット。
// ⚠️「仕入れ商品」ページ導入前に押した品は値が「仕入れ値の数値」だけ＝スナップショットが無い。
//    その旧形式は psnap:{id}（出品用ProfitProduct）から再構成して必ず載せる（取りこぼさない）。送料は used_ship から付与。
export async function getBoughtItems(actor: string | undefined | null): Promise<BoughtItem[]> {
  if (!actor) return [];
  try {
    const [map, ship] = await Promise.all([
      kvReadOnly.hgetall<Record<string, unknown>>(`used_bought:${actor}`),
      kvReadOnly.hgetall<Record<string, number>>(`used_ship:${actor}`),
    ]);
    if (!map) return [];
    const shipOf = (id: string) => (ship && ship[id] !== undefined ? Number(ship[id]) : DEFAULT_SHIP_JPY);
    const out: BoughtItem[] = [];
    const legacy: { id: string; buyJpy: number }[] = [];
    for (const [id, v] of Object.entries(map)) {
      if (v && typeof v === "object" && (v as BoughtItem).id && (v as BoughtItem).title) {
        out.push({ ...(v as BoughtItem), shippingJpy: shipOf(id) }); // 新形式（スナップショット）
      } else {
        legacy.push({ id, buyJpy: typeof v === "number" ? v : 0 }); // 旧形式（数値だけ）→psnapで再構成
      }
    }
    if (legacy.length) {
      const recon = await Promise.all(
        legacy.map(async ({ id, buyJpy }) => {
          try {
            const snap = await kvReadOnly.get<ProfitProduct>(`psnap:${id}`);
            if (snap && snap.id && snap.title) return { ...snap, buyJpy: buyJpy || snap.source?.price, boughtAt: "", shippingJpy: shipOf(id) } as BoughtItem;
          } catch { /* noop */ }
          return null;
        })
      );
      for (const r of recon) if (r) out.push(r);
    }
    return out.sort((a, b) => String(b.boughtAt || "").localeCompare(String(a.boughtAt || "")));
  } catch {
    return [];
  }
}

// ♡お気に入りの商品キー集合（カードの♡初期状態に使う・per-actor）。書き込みは /api/catalog/action の fav/unfav。
export async function getFavoriteKeys(actor: string | undefined | null): Promise<Set<string>> {
  if (!actor) return new Set();
  try {
    const ids = await kvReadOnly.hkeys(`used_fav:${actor}`);
    return new Set<string>((ids ?? []) as string[]);
  } catch {
    return new Set();
  }
}

// ♡お気に入り一覧（新しい順）。値は fav 時に psnap から焼いたスナップショット。旧来idだけの分は psnap で再構成。
export type FavItem = ProfitProduct & { favAt?: string };
export async function getFavoriteItems(actor: string | undefined | null): Promise<FavItem[]> {
  if (!actor) return [];
  try {
    const map = await kvReadOnly.hgetall<Record<string, unknown>>(`used_fav:${actor}`);
    if (!map) return [];
    const out: FavItem[] = [];
    const legacy: string[] = [];
    for (const [id, v] of Object.entries(map)) {
      if (v && typeof v === "object" && (v as FavItem).id && (v as FavItem).title) out.push(v as FavItem);
      else legacy.push(id);
    }
    if (legacy.length) {
      const recon = await Promise.all(
        legacy.map(async (id) => {
          try {
            const snap = await kvReadOnly.get<ProfitProduct>(`psnap:${id}`);
            if (snap && snap.id && snap.title) return { ...snap, favAt: "" } as FavItem;
          } catch { /* noop */ }
          return null;
        })
      );
      for (const r of recon) if (r) out.push(r);
    }
    return out.sort((a, b) => String(b.favAt || "").localeCompare(String(a.favAt || "")));
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
