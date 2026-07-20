import { kvReadOnly } from "./kv";
import type { ProfitProduct } from "./profitFilter";

// 【中古利益カタログ】eBay起点→中古サイト(ハードオフ等)照合→利益判定で作る「儲かる型番」エントリ。
// buildUsedSampleFromCache.mjs(住宅IPワーカー)が KV `used_catalog` に書き、ここで読み出す。
// ⚠️ 旧モデル(新品の ProfitProduct)とは別系統。中古は1点物なので「型番」を主役に扱う。
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
  ebayActiveCount?: number; // eBay現在出品の総数(=競合の厚み)。型番リファイナがBrowse APIで焼き込む。未取得は undefined(=競合不明=中立)。
  // ↓ 型番なしブランド品の「画像一致」レール(refineUsedCatalogImage.mjs)が付与。型番確定なら全て undefined。
  confirmMethod?: "code" | "image"; // 確定方法。"image"=画像一致で確定したブランド品。未定義=従来の型番一致。
  enName?: string; // 画像レールで生成した英語検索名(eBay落札検索に使用)
  matchedEbayUrl?: string; // 画像一致した代表eBay落札の出品URL
  matchedEbayImageUrl?: string; // 画像一致した代表eBay落札のサムネURL(根拠表示用)
  matchedEbayTitle?: string; // 画像一致した代表eBay落札のタイトル
};

// 表示ジャンル（カタログのジャンル絞り込み/バッジ用）。内部の cat は重量(WEIGHT_G)・手数料(ebayFeeRate=時計15%)・
// build上限(CAP_WATCH等)に直結するため細かいまま維持し、ユーザーに見せる粒度だけここで統合する（2026-07-16 ユーザー指示）。
//   オーディオ＋楽器 → オーディオ・楽器 ／ バッグ＋メガネ＋腕時計 → ブランド品 ／ 筆記具＋工具 → 工具・筆記具
const DISPLAY_GENRE: Record<string, string> = {
  オーディオ: "オーディオ・楽器", 楽器: "オーディオ・楽器",
  バッグ: "ブランド品", メガネ: "ブランド品", 腕時計: "ブランド品",
  筆記具: "工具・筆記具", 工具: "工具・筆記具",
  トレカ: "トレカ", トレカBOX: "トレカ", // PSA鑑定シングル＋未開封BOXを1つの表示ジャンルに(2026-07-20)
};
export function displayGenre(cat?: string | null): string {
  const c = cat || "中古";
  return DISPLAY_GENRE[c] ?? c;
}

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
// 落札URL/現行出品URL 共通のeBay検索クエリ。型番(ハイフン空白化)最優先→ライン名→ブランド+商品名。
type EbaySearchInput = { brand?: string; code?: string; name?: string; modelKey?: string };
function ebaySearchQuery(p: EbaySearchInput): string {
  const code = (p.code || "").replace(/-/g, " ").replace(/\s+/g, " ").trim(); // 型番の "-"→空白（eBayの除外演算子回避）
  const line = watchLine(`${p.name || ""} ${p.code || ""} ${p.modelKey || ""}`);
  const q =
    [p.brand, code].filter(Boolean).join(" ").trim() ||        // 型番(ハイフン空白化)を最優先＝特定型番
    (line ? [p.brand, line].filter(Boolean).join(" ") : "") || // 型番が無い時はライン名
    [p.brand, p.name].filter(Boolean).join(" ").trim();
  return q.replace(/\s+/g, " ").trim();
}

export function ebaySoldSearchUrl(p: EbaySearchInput): string {
  // LH_Sold=1&LH_Complete=1＝落札(売れた)のみ。LH_ItemCondition=3000＝中古のみ。_sop=13＝終了日時の新しい順。
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebaySearchQuery(p))}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;
}

// 「今出品されているライバル」＝eBayの現行(アクティブ)出品。LH_Sold/LH_Complete を付けない＝売れ残りでなく現在販売中の競合。
// _sop=15＝価格+送料の安い順＝競合の最安が一番上＝自分がいくらで戦えるか判断しやすい。LH_ItemCondition=3000＝中古のみ。
export function ebayActiveSearchUrl(p: EbaySearchInput): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebaySearchQuery(p))}&LH_ItemCondition=3000&_sop=15`;
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

// このアクターが「仕入れた」or「これは無理」or「無在庫出品した」で外した商品キーの集合。カタログ/ランキングの表示から差し引く。
// 書き込みは /api/catalog/action（used_bought=id→仕入れ値ハッシュ / used_skip=id集合）＋ publish（used_dropship=無在庫出品したid集合）。読みは read-only。
// used_dropship＝無在庫出品した本人(チーム)にだけ隠す＝もう自分は仕入れ検討しない品をカタログに二重表示しない（ユーザー指示2026-07-02）。
export async function getHiddenCatalogKeys(actor: string | undefined | null): Promise<Set<string>> {
  if (!actor) return new Set();
  try {
    const [boughtIds, skip, dropship] = await Promise.all([
      kvReadOnly.hkeys(`used_bought:${actor}`),
      kvReadOnly.smembers(`used_skip:${actor}`),
      kvReadOnly.smembers(`used_dropship:${actor}`),
    ]);
    return new Set<string>([...(boughtIds ?? []), ...(skip ?? []), ...(dropship ?? [])] as string[]);
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
      // ★N+1回避(2026-07-11)：psnap を個別GET×N でなく mget 1回でまとめて引く（順序は入力キー順に対応・欠損はnull）。
      try {
        const snaps = (await kvReadOnly.mget(...legacy.map(({ id }) => `psnap:${id}`))) as (ProfitProduct | null)[];
        legacy.forEach(({ id, buyJpy }, i) => {
          const snap = snaps[i];
          if (snap && snap.id && snap.title) out.push({ ...snap, buyJpy: buyJpy || snap.source?.price, boughtAt: "", shippingJpy: shipOf(id) } as BoughtItem);
        });
      } catch { /* noop（再構成失敗時は新形式ぶんだけ返す・従来と同じ非破壊） */ }
    }
    // 利益率＝純利益÷仕入れ(ROI)に統一（保存スナップショットが旧定義=粗利率の場合があるため再計算）。
    return out
      .map((p) => {
        const cost = p.buyJpy ?? p.source?.price ?? 0;
        return cost > 0 ? { ...p, realProfitRate: Math.round(((p.realProfit ?? 0) / cost) * 100) } : p;
      })
      .sort((a, b) => String(b.boughtAt || "").localeCompare(String(a.boughtAt || "")));
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
    // 利益率＝純利益÷仕入れ(ROI)に統一（カタログと同じ定義に揃える）。
    return out
      .map((p) => {
        const cost = p.source?.price ?? 0;
        return cost > 0 ? { ...p, realProfitRate: Math.round(((p.realProfit ?? 0) / cost) * 100) } : p;
      })
      .sort((a, b) => String(b.favAt || "").localeCompare(String(a.favAt || "")));
  } catch {
    return [];
  }
}

// KVから中古カタログを読む（読み取り専用トークン）。型番DB＝中古はモデル単位で見る。
export async function getUsedCatalog(): Promise<UsedCatalogItem[]> {
  try {
    // used_source_status＝仕入れ元(ハードオフ)が売切/削除と判定された品(hardoffLivenessWorkerが立てる)。一覧から隠す。
    const [arr, srcStatus] = await Promise.all([
      kvReadOnly.get<UsedCatalogItem[]>("used_catalog"),
      kvReadOnly.hgetall<Record<string, unknown>>("used_source_status").catch(() => ({})),
    ]);
    if (!Array.isArray(arr)) return [];
    const flagged: Record<string, unknown> = srcStatus || {};
    // 値は通常オブジェクト{status,at}。KVクライアント差で文字列で返る場合に備え string なら JSON.parse する
    // （/api/products の catalog_source_status と同じ防御＝消費側の挙動を揃える）。
    const FLAG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 売切/削除フラグの有効期限＝これ超は「不明」扱いで再表示(fail-open)。
    const isSoldOut = (id?: string) => {
      let f: unknown = id ? flagged[id] : null;
      if (typeof f === "string") { try { f = JSON.parse(f); } catch { return false; } }
      const rec = f as { status?: string; at?: string } | null;
      const st = rec?.status;
      if (st !== "soldout" && st !== "dead") return false;
      // ★古いフラグは再表示(2026-07-08)：在庫復活/再入荷や、ワーカー停止中に立てっぱなしのフラグで
      //   買える利益商品を永久に隠さない。ワーカーが再確認して本当に売切なら立て直す(fail-open)。
      if (rec?.at) { const age = Date.now() - Date.parse(rec.at); if (Number.isFinite(age) && age > FLAG_MAX_AGE_MS) return false; }
      return true;
    };
    // ★精度極限ゲート：確定品(ebayConfirmed=同一型番でeBay実落札を照合済＝精密な想定売値)を優先配信する。
    //   build直後の未確定候補は「カテゴリ系列の中央値＝目安」で精度が落ちるため、確定品が十分ある時はそれだけ出す。
    //   既定ON。env USED_CATALOG_CONFIRMED_ONLY=0 で常に目安品も出せる。
    const confirmedOnly = process.env.USED_CATALOG_CONFIRMED_ONLY !== "0";
    // 利益率＝純利益 ÷ 仕入れ価格（ROI）に配信時で統一（古いKVの粗利率書き込みでも正しくなるよう毎回再計算）。
    // 最終ゲート：profitJpyが数値／売切でない／ROI>=10%。ここまでが「配信してよい品」の母数。
    const base = arr
      .filter((x) => x && typeof x.profitJpy === "number")
      .filter((x) => !isSoldOut(x.id)) // 仕入れ元が売切/削除＝もう仕入れられないので一覧から隠す
      .map((x) => ({ ...x, profitRate: x.buyJpy > 0 ? Math.round((x.profitJpy / x.buyJpy) * 100) : 0 }))
      // ⚠️ 端数で「10%」表示なのに除外…を避けるため生比率(>=0.10)で判定（round前）。
      .filter((x) => x.buyJpy > 0 && x.profitJpy / x.buyJpy >= 0.1);
    const confirmed = base.filter((x) => x.ebayConfirmed === true);
    // ★自己回復の安全網：確定品が十分あれば確定のみ（精度優先）。だが確定が薄い(refineの枯れ/復旧中)ときは
    //   目安品も出して一覧を絶対に空にしない。復旧で確定が MIN_CONFIRMED 以上に戻れば自動で確定のみへ戻る。
    //   ＝2026-07-04 カタログ全消え(refineが確定を一過性0件でdrop→確定0件)の再発を配信側でも二度と起こさない担保。
    const MIN_CONFIRMED = 300;
    // ★確定の"広さ"はユニーク型番数で測る(2026-07-08)：重複ID/同一モデルの多数在庫でrow数が水増し/変動し足切りがブレるため、行数でなくdistinct codeで判定。
    // 型番はdistinct code、型番なしの画像一致確定(confirmMethod="image")は hardoffUrl で数える
    // ＝code空が空文字1バケツに潰れて「確定の広さ」に寄与しない副作用を回避（画像確定品が増えても目安モードに落ちない）。
    const confirmedCodes = new Set(
      confirmed
        .map((x) => {
          const c = String(x.code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          return c || (x.confirmMethod === "image" ? "url:" + (x.hardoffUrl || x.id || "") : "");
        })
        .filter((k) => k && k !== "url:")
    ).size;
    const serve = confirmedOnly && confirmedCodes >= MIN_CONFIRMED ? confirmed : base;
    return serve.sort((a, b) => b.profitJpy - a.profitJpy); // 利益額の高い順（書込側でソート済みだが配信時も保証）
  } catch {
    return [];
  }
}
