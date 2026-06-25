import { kvReadOnly } from "./kv";

// 【中古利益カタログ】eBay起点→中古サイト(ハードオフ等)照合→利益判定で作る「儲かる型番」エントリ。
// buildUsedCatalog.mjs(住宅IPワーカー)が KV `used_catalog` に書き、ここで読み出す。
// ⚠️ 旧モデル(楽天新品の ProfitProduct)とは別系統。中古は1点物なので「型番」を主役に扱う。
export type UsedCatalogItem = {
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
};

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
