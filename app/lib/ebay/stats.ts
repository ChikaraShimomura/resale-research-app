// マイページの収支ダッシュボード用：アプリ出品→売れた取引の集計（仕入れ/売上/利益・月別/年別）。サーバー専用。
// 取引は端末(アクター)単位で KV のハッシュ ebay_deals:{actor} に蓄積する。
import { kv } from "@vercel/kv";
import { toRakutenProductUrl } from "../utils";
// USD_JPY は SSOT(landedCostCore・env駆動/既定155)に一本化（旧:ハードコード155）。再エクスポートで既存consumer維持。
import { USD_JPY, ebayFeeRate, ebayFeeFixedJpy } from "./landedCostCore.mjs";
export { USD_JPY };
// 売却実績P&Lの手数料。dealにカテゴリが無いので既定の実効率 ebayFeeRate(null)=約16.95%(FVF13.6%+海外決済1.35%+為替2%)を使う。
// ＝従来の一律13.25%より実態に近い（時計は本来18.35%だが deal にカテゴリ非保持のため既定16.95%扱い＝実績P&Lは過去実績の表示用で許容）。
const EBAY_FEE_RATE = ebayFeeRate(null);
const EBAY_FEE_FIXED = ebayFeeFixedJpy();

const DEALS_KEY = (actor: string) => `ebay_deals:${actor}`;
// SKU対応表。eBayに「公開できた(result.ok)」時だけ書かれる＝実際に出品できた証跡。listing.ts と一致。
const SKU_MAP_KEY = (actor: string) => `ebay_sku_map:${actor}`;
const TTL_SECONDS = 730 * 24 * 60 * 60; // 取引履歴は2年保持（出品/出荷の都度 expire を再延長）
// 出品停止中に入ってから24時間で「アーカイブ（過去の出品）」へ移す。
const STOPPED_TTL_MS = 24 * 60 * 60 * 1000;
// アーカイブ（過去の出品）に入ってから24時間で完全削除する（ユーザー指示2026-06-27：停止中/過去は24hで削除）。
// ＝ 停止 → 24h → 過去 → 24h → 削除。未売却のみ対象（売れた商品=成績は残す）。仕入れ記録(used_bought)も併せて消す。
const ARCHIVE_DELETE_MS = 24 * 60 * 60 * 1000;

// 満了(SOLD)枠＝1商品を同時出品中の出品者(actor)集合。publish が acquire、出品停止/やめた/売却で必ず release する。
// メンバーは台帳(ebay_deals:{actor})と同じ actor に統一（旧実装は端末did基準で、複数端末の多重消費＋解放不能＝枠が
// 永久占有され商品が誤って満了化するバグがあった）。キーは商品ID共有。release が無いと枠がリークし続ける。
const LISTING_ACTORS_KEY = (productId: string) => `listing_actors:${productId}`;
export async function releaseListingSlot(actor: string, productId: string): Promise<void> {
  try {
    await kv.srem(LISTING_ACTORS_KEY(productId), actor);
  } catch {
    /* noop（解放失敗は90日TTLで自然失効） */
  }
}

// 「実際に出品できた商品」だけを通す判定を返す。
// 旧仕様では下書き/本人確認待ちでも deal を記録していたため、SKU対応表に載っているものだけを
// 「出品中/出品実績」として扱う（公開できなかった取りこぼしを集計から除外する）。
async function publishedFilter(actor: string): Promise<(productId: string) => boolean> {
  let skuMap: Record<string, string> = {};
  try {
    skuMap = (await kv.hgetall<Record<string, string>>(SKU_MAP_KEY(actor))) ?? {};
  } catch {
    /* noop */
  }
  // SKU対応表は { sku: productId }。出品済み判定は「productId が値に含まれるか」で見る。
  // こうすると自己修復で sku が rr-{id}-{乱数} に変わっても、商品が出品中一覧から消えない
  // （旧データ＝sku=rr-{id} でも値は productId なので結果は同じ＝後方互換）。
  const publishedProductIds = new Set(Object.values(skuMap));
  return (productId: string) => publishedProductIds.has(productId);
}

export interface Deal {
  purchase: number; // 仕入れ値(JPY)
  points: number; // 基本ポイント
  title: string;
  imageUrl?: string; // 商品画像（一覧のサムネ用。新規出品から保存）
  sourceUrl?: string; // 仕入れ元の商品ページ直URL（「仕入れ」ボタン用）。カタログから補完して焼き込む＝失効後も残る
  listedAt: string;
  listingId?: string; // eBayの公開ID（https://www.ebay.com/itm/{listingId}）。出品成功時に保存。マイページの「写真追加」で当該出品へ直リンクするのに使う
  sku?: string; // 実際に公開に使ったSKU（自己修復で rr-{id}-{乱数} になり得る）。アプリ内編集(価格/数量)の対象オファー特定に使う
  dropship?: boolean; // 無在庫出品（仕入れ前にeBay出品）。trueの出品だけ「売り切れ検知→自動停止」の対象にする（有在庫=所有済みは対象外）。
  stoppedAt?: string; // 「出品停止」を押した日時(ISO)。出品停止中一覧に表示。再出品で解除。
  archivedAt?: string; // 出品停止のまま24時間を過ぎて「過去の出品(アーカイブ)」へ移した日時(ISO)。既定の出品停止中一覧からは外すがレコード/成績は残す。再出品で解除。完全削除は手動のみ。
  sourceStatus?: "dead" | "soldout"; // 仕入れ元が掲載終了/売り切れの時に立つ（checkListings cronが~30分毎に更新）
  sourceCheckedAt?: string; // 仕入れ元の最終確認日時(ISO)
  priceDrift?: { nowJpy: number; pct: number; at: string }; // ④ 仕入れ元の現在価格が出品時原価を閾値以上上回った時に立つ（checkListings cron）
  stopFailedCount?: number; // 自動取り下げ(reconcileActorStops)の連続失敗回数。一定超で「手動でeBayから取り下げを」とUI表示
  stopFailedAt?: string; // 最後に自動取り下げが失敗した日時(ISO)
  soldUsd?: number; // eBay売値(USD)
  soldAt?: string;
}

// 出品時：取引を記録（売却情報があれば壊さないようマージ）。
export async function recordListed(
  actor: string,
  productId: string,
  d: { purchase: number; points: number; title: string; imageUrl?: string; sourceUrl?: string; listedAt: string; listingId?: string; sku?: string; dropship?: boolean }
): Promise<void> {
  try {
    const existing = (await kv.hget<Deal>(DEALS_KEY(actor), productId)) ?? null;
    // 既に記録済み（再出品・下書き再公開）は金額・listedAt・売却情報を維持し、上書きしない
    if (!existing) {
      await kv.hset(DEALS_KEY(actor), { [productId]: { ...d } });
    } else if (
      (d.listingId && existing.listingId !== d.listingId) ||
      (d.sku && existing.sku !== d.sku) ||
      existing.stoppedAt != null ||
      existing.archivedAt != null
    ) {
      // 再出品/自己修復で公開ID・SKUが変わった/初めて取れた時だけ更新（金額・出品日・売却情報は維持）。
      // recordListed は公開成功時のみ呼ばれる＝再び出品中なので、停止フラグ(stoppedAt)とアーカイブ(archivedAt)は解除する。
      const next: Deal = {
        ...existing,
        ...(d.listingId ? { listingId: d.listingId } : {}),
        ...(d.sku ? { sku: d.sku } : {}),
      };
      // 無在庫フラグは再出品ペイロードで明示的に上書き：true=対象化 / false=有在庫化＝自動停止対象から確実に外す
      // （無在庫→仕入れて所有→有在庫で出し直した時に、古い dropship:true が残って誤自動停止されるのを防ぐ）。
      if (d.dropship === true) next.dropship = true;
      else if (d.dropship === false) delete next.dropship;
      delete next.stoppedAt;
      delete next.archivedAt;
      await kv.hset(DEALS_KEY(actor), { [productId]: next });
    }
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
  } catch {
    /* noop */
  }
}

// 売却検知時：売値を記録（未記録のときだけ）。
// 出品記録(existing)が無くても売却は取りこぼさず記録する：仕入れ・ポイント等は無し(0)の
// 最小Dealをupsertする。既存があれば売却情報だけ足し、既に売却記録済みなら何もしない。
export async function recordSold(
  actor: string,
  productId: string,
  soldUsd: number,
  soldAt: string
): Promise<void> {
  try {
    const existing = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    if (existing?.soldUsd != null) return; // 既に売却記録済み
    const base: Deal = existing ?? { purchase: 0, points: 0, title: "", listedAt: soldAt };
    await kv.hset(DEALS_KEY(actor), { [productId]: { ...base, soldUsd, soldAt } });
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
    await releaseListingSlot(actor, productId); // 売却＝eBay出品終了→満了枠を解放（次の出品者に空ける）
  } catch {
    /* noop */
  }
}

// 出品中（未売却）の取引一覧。マイページで個別に「やめた/売れた」を手動調整するため。
export interface LiveDeal {
  id: string;
  title: string;
  listedAt: string;
  purchase: number; // 仕入れ(送料込・JPY)
  imageUrl: string; // 商品画像（無い古いdealは現行カタログから補完。見つからなければ空）
  sourceUrl?: string; // 仕入れ元の商品ページ直URL（「仕入れ」ボタン）。無い旧deal/失効商品では undefined→商品名検索にフォールバック
  listingId?: string; // eBay公開ID。あれば「写真追加」をその出品ページへ直リンク（無い旧データは出品一覧へ）
  stoppedAt?: string; // 出品停止中一覧の項目に付く停止日時。出品中の項目では undefined。
  archivedAt?: string; // 「過去の出品(アーカイブ)」一覧の項目に付くアーカイブ日時。出品中/停止中では undefined。
  sourceStatus?: "dead" | "soldout"; // 仕入れ元が掲載終了/売り切れの時に⚠️表示するためのフラグ
  priceDrift?: { nowJpy: number; pct: number; at: string }; // ④ 仕入れ元の値上がり警告（出品時原価を閾値超過）
  stopFailedCount?: number; // 自動取り下げが繰り返し失敗（一定超で「手動でeBayから取り下げを」と表示）
  dropship?: boolean; // 無在庫出品＝一覧に「無在庫」ラベルを出す＋売り切れ検知→自動停止の対象
}
export interface SoldDeal {
  id: string;
  title: string;
  imageUrl: string;
  soldAt: string;
  soldJpy: number; // 売れた金額(JPY換算)
  profitJpy: number; // 現金利益(売上−手数料−仕入れ)。ポイントは含めない＝別枠(points)で扱う
  purchase: number; // 仕入れ(送料込・JPY)
}

// 出品停止中(未売却・stoppedAtあり)で、停止から24時間を過ぎ、まだアーカイブされていない取引のID
// （自動アーカイブの対象）。stoppedAt が不正・空のものは NaN 比較で false → 触らない（安全側）。
// ⚠️ 自動削除はしない：レコード・成績は残し、既定の出品停止中一覧から外すだけ（archivedAt を立てる）。
function expiredStopIds(deals: Record<string, Deal>, now: number): string[] {
  return Object.entries(deals)
    .filter(
      ([, d]) =>
        d &&
        d.soldUsd == null &&
        d.stoppedAt != null &&
        d.archivedAt == null &&
        now - Date.parse(d.stoppedAt) >= STOPPED_TTL_MS
    )
    .map(([id]) => id);
}

// 古い停止品を「アーカイブ（既定で隠す）」へ移す＝archivedAt を立てるだけ。レコード/SKU対応表/成績は一切消さない。
// 完全削除はユーザーの手動操作(removeDeal / deleteDealsWithSku)だけ。停止品は isPublished=false のはずなので
// SKU対応表は触らない（publishedFilter を壊さない）。archive 済みは stoppedAt のままなので listListedProductIds /
// getStats の「停止中(未売却)」分類はそのまま効く＝検索一覧に出ず、出品中件数にも入らない（互換維持）。
async function archiveDeals(actor: string, deals: Record<string, Deal>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const patch: Record<string, Deal> = {};
  for (const id of ids) {
    const d = deals[id];
    if (d) patch[id] = { ...d, archivedAt: now };
  }
  if (!Object.keys(patch).length) return;
  try {
    await kv.hset(DEALS_KEY(actor), patch);
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
    for (const id of ids) if (deals[id]) deals[id] = patch[id]; // 呼び出し元のローカルコピーも同期
  } catch {
    /* noop（次回リトライ） */
  }
}

// アーカイブ（過去の出品）に入って24時間を過ぎた未売却取引のID。これを過ぎたら完全削除する（ユーザー指示2026-06-27）。
function expiredArchivedIds(deals: Record<string, Deal>, now: number): string[] {
  return Object.entries(deals)
    .filter(([, d]) => d && d.soldUsd == null && d.archivedAt != null && now - Date.parse(d.archivedAt) >= ARCHIVE_DELETE_MS)
    .map(([id]) => id);
}

// 過去の出品（アーカイブ後24h）を完全削除する。取引(deals)＋SKU対応表＋仕入れ記録(used_bought)を消し、満了枠も解放。
// ＝ 商品管理から完全に消える（出品中/仕入れ商品/お気に入りのどれにも出戻らない）。売れた商品は対象外（成績は残す）。
async function deleteArchivedExpired(actor: string, deals: Record<string, Deal>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await deleteDealsWithSku(actor, ids); // deals本体＋SKU対応表
  try { await kv.hdel(`used_bought:${actor}`, ...ids); } catch { /* noop */ }
  try { await kv.hdel(`used_ship:${actor}`, ...ids); } catch { /* noop */ }
  for (const id of ids) {
    delete deals[id]; // ローカルコピーからも除外
    await releaseListingSlot(actor, id);
  }
}

// 出品に失敗して残った「幽霊deal」を仕入れ商品へ戻す自己修復。
// listingId も sku も無い deal ＝ 公開が一度も成功していない（sku は公開成功時にしか保存されない）。
// 出品失敗時にこの deal だけ残ると、仕入れ商品（deal がある＝出品済み扱いで除外）からも
// 出品中（未公開＝SKU対応表に無い）からも消えて行方不明になる。そこで仕入れ記録へ復元し幽霊dealを削除する。
async function healOrphanDeals(actor: string, deals: Record<string, Deal>): Promise<void> {
  const orphans = Object.entries(deals).filter(
    ([, d]) => d && d.soldUsd == null && !d.stoppedAt && !d.archivedAt && !d.listingId && !d.sku
  );
  if (!orphans.length) return;
  const restore: Record<string, unknown> = {};
  for (const [id, d] of orphans) {
    // 仕入れ商品(used_bought)のスナップショット形式で復元（deal が持つ情報だけで再構成）。
    restore[id] = {
      id,
      title: d.title || "",
      imageUrl: d.imageUrl,
      buyJpy: d.purchase ?? 0,
      points: d.points ?? 0,
      boughtAt: d.listedAt || new Date().toISOString(),
      source: { url: d.sourceUrl, price: d.purchase ?? 0 },
    };
    delete deals[id]; // 以降の分類に出ないようローカルからも除去
  }
  try {
    await kv.hset(`used_bought:${actor}`, restore);
    await kv.expire(`used_bought:${actor}`, TTL_SECONDS);
    await kv.hdel(DEALS_KEY(actor), ...orphans.map(([id]) => id));
  } catch {
    /* noop（次回読込で再試行） */
  }
}

// cron/読み込み用：停止24h→アーカイブ／アーカイブ24h→完全削除 をまとめて適用。削除/アーカイブした件数の合計を返す。
export async function pruneExpiredArchived(actor: string): Promise<number> {
  let deals: Record<string, Deal> = {};
  try { deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {}; } catch { return 0; }
  const now = Date.now();
  const stops = expiredStopIds(deals, now);
  await archiveDeals(actor, deals, stops);
  const archived = expiredArchivedIds(deals, now);
  await deleteArchivedExpired(actor, deals, archived);
  return stops.length + archived.length;
}

// 取引を完全削除する（deals本体＋SKU対応表の該当エントリ）。⚠️ ユーザーの手動操作専用
// （「やめた／削除」＝removeDeal 経由）。自動処理(cron/read)は削除せずアーカイブ(archiveDeals)に置換済み。
// SKU対応表を残すと publishedFilter が「出品中」と誤認し、その商品が検索一覧から消えたままになるため、
// 値=productId のSKUキーも必ず消す（自己修復で rr-{id}-{乱数} になっていても値で拾えるので取りこぼさない）。
export async function deleteDealsWithSku(actor: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const idSet = new Set(ids);
  try {
    await kv.hdel(DEALS_KEY(actor), ...ids);
  } catch {
    /* noop */
  }
  try {
    const skuMap = (await kv.hgetall<Record<string, string>>(SKU_MAP_KEY(actor))) ?? {};
    const skuKeys = Object.entries(skuMap)
      .filter(([, pid]) => idSet.has(pid))
      .map(([sku]) => sku);
    if (skuKeys.length) await kv.hdel(SKU_MAP_KEY(actor), ...skuKeys);
  } catch {
    /* noop */
  }
  // 完全削除＝もう競合しない→満了枠(listing_actors)も解放。残すと該当商品が「出品中(満了)」扱いのまま
  // 他の出品者にも90日(TTL満了まで)出品ブロックがかかり続ける＝ゾンビ枠になる。
  for (const id of ids) {
    await releaseListingSlot(actor, id);
  }
  // 無在庫出品のカタログ非表示も解除（完全削除＝もう出品していないのでカタログに戻す）。srem は非メンバーに no-op。
  try { await kv.srem(`used_dropship:${actor}`, ...ids); } catch { /* noop */ }
}

// cron用：出品停止中に入って24時間を過ぎた取引をまとめて「アーカイブ（既定で隠す）」へ移す。アーカイブしたIDを返す。
// ⚠️ 完全削除はしない（レコード・成績・再出品候補は保持）。離席中でも auto-stop-cron から呼ばれ、ユーザーが
// マイページを開かなくても既定の出品停止中一覧から外れる。関数名は呼び出し互換のため据え置き（旧名 prune＝掃除の意味）。
export async function pruneExpiredStops(actor: string): Promise<string[]> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    return [];
  }
  const ids = expiredStopIds(deals, Date.now());
  await archiveDeals(actor, deals, ids);
  return ids;
}

// マイページ用：出品中(未売却・公開済み)と輸出した(売却済み)の取引一覧をまとめて返す。
// deals ハッシュ1回・SKU対応表1回・画像補完カタログ1回で両方を組み立てる。
export async function listDealsForUser(
  actor: string
): Promise<{ live: LiveDeal[]; stopped: LiveDeal[]; archived: LiveDeal[]; sold: SoldDeal[] }> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    return { live: [], stopped: [], archived: [], sold: [] };
  }
  // 停止24h→アーカイブ（過去の出品）／アーカイブ24h→完全削除 を読み込み時にも実行（cronが回らない間も反映）。
  // 過去の出品は24h後に取引・SKU対応表・仕入れ記録ごと完全削除（ユーザー指示2026-06-27）。売れた商品は対象外。
  const now = Date.now();
  const expiredStops = expiredStopIds(deals, now);
  if (expiredStops.length) {
    await archiveDeals(actor, deals, expiredStops); // deals のローカルコピーも archivedAt 付きに同期される
  }
  const expiredArchived = expiredArchivedIds(deals, now);
  if (expiredArchived.length) {
    await deleteArchivedExpired(actor, deals, expiredArchived); // deals のローカルからも除去される
  }
  // 出品失敗で残った「幽霊deal」を仕入れ商品へ自己修復（仕入れ商品からも出品中からも消える事故の救済）。
  await healOrphanDeals(actor, deals);
  const isPublished = await publishedFilter(actor);
  const entries = Object.entries(deals);
  const soldEntries = entries.filter(([, d]) => d.soldUsd != null); // 売却済み（実取引なので全部有効）
  // 出品停止中＝未売却 かつ stoppedAt あり かつ まだアーカイブされていない（出品中より優先して分類）。
  const stoppedEntries = entries.filter(([, d]) => d.soldUsd == null && d.stoppedAt != null && d.archivedAt == null);
  // アーカイブ＝未売却 かつ archivedAt あり（既定の出品停止中一覧からは外し「過去の出品」へ。再出品で復帰可）。
  const archivedEntries = entries.filter(([, d]) => d.soldUsd == null && d.archivedAt != null);
  // 出品中＝未売却 かつ 停止していない かつ 公開済み。listingId があれば SKU対応表が欠けていても出品中として拾う
  // （旧データで sku 未保存＝公開IDはあるのに出品中一覧から消える事故を防ぐ）。
  const liveEntries = entries.filter(([id, d]) => d.soldUsd == null && d.stoppedAt == null && (isPublished(id) || !!d.listingId));

  // 画像/タイトル未保存の古いdealは、現行カタログ(profitable_products)から補完する。
  // さらに補完できた値は deal 自体に焼き込み直す＝以後はカタログに依存しない（商品が利益商品から
  // 外れても出品中/販売した一覧の表示が欠けないようにする。新規dealは出品時に保存済みで対象外）。
  const catInfo: Record<string, { imageUrl?: string; title?: string; sourceUrl?: string }> = {};
  // 出品中/停止中/アーカイブは「仕入れ」ボタン用に仕入れ元URL(sourceUrl)も要る（売却済みは不要なのでトリガに含めない）。
  const needBackfill =
    [...liveEntries, ...stoppedEntries, ...archivedEntries, ...soldEntries].some(([, d]) => !d.imageUrl || !d.title) ||
    [...liveEntries, ...stoppedEntries, ...archivedEntries].some(([, d]) => !d.sourceUrl);
  if (needBackfill) {
    try {
      const products =
        (await kv.get<{ id: string; imageUrl?: string; title?: string; source?: { url?: string } }[]>("profitable_products")) ?? [];
      for (const p of products)
        if (p?.id)
          catInfo[p.id] = { imageUrl: p.imageUrl, title: p.title, sourceUrl: toRakutenProductUrl(p.source?.url ?? "") || undefined };
    } catch {
      /* noop */
    }
    // カタログから外れた(rotate out)出品は psnap:{id} アーカイブ(2年保持・getProductById と同じ源)から補完する。
    // 失効済みの出品でも仕入れURL/画像/タイトルが届き、heal で焼き込めて needBackfill が収束する（毎ロードの全件再取得を断つ）。
    const missing = [...liveEntries, ...stoppedEntries, ...archivedEntries].map(([id]) => id).filter((id) => !catInfo[id]?.sourceUrl);
    if (missing.length) {
      try {
        const snaps = (await kv.mget(...missing.map((id) => `psnap:${id}`))) as (
          { imageUrl?: string; title?: string; source?: { url?: string } } | null
        )[];
        missing.forEach((id, i) => {
          const s = snaps[i];
          if (!s) return;
          const prev = catInfo[id] ?? {};
          catInfo[id] = {
            imageUrl: prev.imageUrl ?? s.imageUrl,
            title: prev.title ?? s.title,
            sourceUrl: prev.sourceUrl ?? (toRakutenProductUrl(s.source?.url ?? "") || undefined),
          };
        });
      } catch {
        /* noop */
      }
    }
    // 補完できた分だけ deal に保存し直す（best-effort・カタログがまだ持っているうちに永続化）。
    const heal: Record<string, Deal> = {};
    for (const [id, d] of [...liveEntries, ...stoppedEntries, ...archivedEntries, ...soldEntries]) {
      const img = !d.imageUrl ? catInfo[id]?.imageUrl : undefined;
      const ttl = !d.title ? catInfo[id]?.title : undefined;
      const src = !d.sourceUrl ? catInfo[id]?.sourceUrl : undefined;
      if (img || ttl || src)
        heal[id] = { ...d, ...(img ? { imageUrl: img } : {}), ...(ttl ? { title: ttl } : {}), ...(src ? { sourceUrl: src } : {}) };
    }
    if (Object.keys(heal).length) {
      try {
        await kv.hset(DEALS_KEY(actor), heal);
        await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
      } catch {
        /* noop */
      }
    }
  }

  const live: LiveDeal[] = liveEntries
    .map(([id, d]) => ({
      id,
      title: d.title || catInfo[id]?.title || "",
      listedAt: d.listedAt || "",
      purchase: d.purchase ?? 0,
      imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
      sourceUrl: d.sourceUrl || catInfo[id]?.sourceUrl || undefined,
      listingId: d.listingId,
      sourceStatus: d.sourceStatus, // 仕入れ元が売り切れ/リンク切れなら⚠️
      priceDrift: d.priceDrift, // ④ 仕入れ元の値上がり警告
      stopFailedCount: d.stopFailedCount, // 自動取り下げ連続失敗（手動対応を促す）
      dropship: d.dropship, // 無在庫ラベル表示用
    }))
    .sort((a, b) => (b.listedAt || "").localeCompare(a.listedAt || "")); // 新しい順

  const stopped: LiveDeal[] = stoppedEntries
    .map(([id, d]) => ({
      id,
      title: d.title || catInfo[id]?.title || "",
      listedAt: d.listedAt || "",
      purchase: d.purchase ?? 0,
      imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
      sourceUrl: d.sourceUrl || catInfo[id]?.sourceUrl || undefined,
      listingId: d.listingId,
      stoppedAt: d.stoppedAt,
      sourceStatus: d.sourceStatus, // 自動停止の理由(売切/リンク切れ)を停止中一覧でも表示
      dropship: d.dropship, // 無在庫ラベル表示用
    }))
    .sort((a, b) => (b.stoppedAt || "").localeCompare(a.stoppedAt || "")); // 停止が新しい順

  // 過去の出品（アーカイブ）：24時間を過ぎて既定の停止中一覧から外した分。レコードは保持＝再出品で復帰できる。
  const archived: LiveDeal[] = archivedEntries
    .map(([id, d]) => ({
      id,
      title: d.title || catInfo[id]?.title || "",
      listedAt: d.listedAt || "",
      purchase: d.purchase ?? 0,
      imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
      sourceUrl: d.sourceUrl || catInfo[id]?.sourceUrl || undefined,
      listingId: d.listingId,
      stoppedAt: d.stoppedAt,
      archivedAt: d.archivedAt,
      sourceStatus: d.sourceStatus, // 自動停止の理由(売切/リンク切れ)はアーカイブでも表示
    }))
    .sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || "")); // アーカイブが新しい順

  const sold: SoldDeal[] = soldEntries
    .map(([id, d]) => {
      const saleJpy = Math.round(Math.max(0, Number(d.soldUsd) || 0) * USD_JPY); // 不正値(NaN/負)で利益が汚染されないようクランプ
      const fee = Math.round(saleJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED;
      return {
        id,
        title: d.title || catInfo[id]?.title || "",
        imageUrl: d.imageUrl || catInfo[id]?.imageUrl || "",
        soldAt: d.soldAt || "",
        soldJpy: saleJpy,
        profitJpy: saleJpy - fee - (d.purchase ?? 0), // 現金利益（ポイントは含めない＝別枠）
        purchase: d.purchase ?? 0,
      };
    })
    .sort((a, b) => (b.soldAt || "").localeCompare(a.soldAt || "")); // 新しい順

  return { live, stopped, archived, sold };
}

// 「実際に出品中(公開済み) or 売却済みの商品ID」を返す。検索一覧で本人の出品済みを隠す／仕入れ中一覧から
// 除外する、の両方で使う。ログイン時は actor=acct:{uuid} なのでアカウントに紐づき別端末でも同じIDが返る。
// 重要: deal のキーがあっても sku_map が無く未売却の“幽霊deal”(eBay連携の解除等で sku_map だけ消えた状態)は
// 「出品済み」とみなさない。みなすと、その商品が検索からも仕入れ中からも消えてどのリストにも出なくなるため
// （実際にはまた仕入れ/出品できる状態）。出品中(isPublished) か 売却済み(soldUsd) のものだけを返す。
export async function listListedProductIds(actor: string): Promise<string[]> {
  try {
    const deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
    const isPublished = await publishedFilter(actor);
    // 売却済み・出品停止中・出品中は検索一覧に出さない（停止中は出品停止中一覧へ駐機）。
    return Object.entries(deals)
      .filter(([id, d]) => d?.soldUsd != null || d?.stoppedAt != null || isPublished(id))
      .map(([id]) => id);
  } catch {
    return [];
  }
}

// 出品に使われたSKUを返す（アプリ内編集／出品停止の対象オファー特定用）。無ければ null。
export async function getListingSku(actor: string, productId: string): Promise<string | null> {
  try {
    const deal = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    return deal?.sku ?? null;
  } catch {
    return null;
  }
}

// 「出品停止」：取引に停止フラグ(stoppedAt)を立て、出品停止中一覧へ移す。dealが無ければ何もしない
// （仕入れ中のみで未出品の商品など）。再出品(recordListed)で stoppedAt は自動解除される。
export async function markStopped(actor: string, productId: string): Promise<void> {
  try {
    const existing = await kv.hget<Deal>(DEALS_KEY(actor), productId);
    if (!existing) return;
    await kv.hset(DEALS_KEY(actor), { [productId]: { ...existing, stoppedAt: new Date().toISOString() } });
    await kv.expire(DEALS_KEY(actor), TTL_SECONDS);
    await releaseListingSlot(actor, productId); // 出品停止＝もう競合しない→満了枠を解放
  } catch {
    /* noop */
  }
}

// 「出品をやめた」：成績から取引を削除する（hdel）。
export async function removeDeal(actor: string, productId: string): Promise<void> {
  try {
    await kv.hdel(DEALS_KEY(actor), productId);
    await releaseListingSlot(actor, productId); // 取引削除＝満了枠も解放
  } catch {
    /* noop */
  }
}

// 月別(売却月)集計。マイページの「収支の推移」グラフ（月別/年別）用。
export interface MonthPoint {
  month: string; // "2026-06"
  label: string; // "6月"
  profit: number;
  sales: number;
  purchase: number;
  count: number;
}

export interface Stats {
  soldCount: number;
  listedCount: number;
  boughtOnHandJpy: number; // 「仕入れた」のうち未出品(deals未在籍)分の仕入れ値合計(JPY・送料込)。参考
  boughtOnHandCount: number; // 同・件数
  boughtTotalJpy: number; // 「仕入れた商品(used_bought)」全件の仕入れ値合計(JPY・送料込)＝収支の仕入れ累計。/boughtと一致
  boughtTotalCount: number; // 同・件数
  listedPurchase: number; // 出品中(未売却)の仕入れ合計(JPY・仕入れ価格+国内送料)
  totalPurchase: number; // 仕入れ合計(JPY・売れたもの)
  totalSales: number; // 売上合計(JPY換算)
  totalProfit: number; // 現金利益(売上-仕入れ-手数料)。ポイントは含めない＝totalPoints で別枠
  totalPoints: number; // ポイント累計(売れたもの・おまけ。利益には含めない)
  totalFees: number; // eBay手数料合計(JPY)
  avgProfit: number; // 1件あたり平均利益(売れたもの)
  bestProfit: number; // 最も稼いだ1取引の利益
  monthly: MonthPoint[]; // 月別集計(売却月・昇順)。マイページで月別/年別グラフに使う
}

export async function getStats(actor: string): Promise<Stats> {
  let deals: Record<string, Deal> = {};
  try {
    deals = (await kv.hgetall<Record<string, Deal>>(DEALS_KEY(actor))) ?? {};
  } catch {
    /* noop */
  }
  const isPublished = await publishedFilter(actor);
  const entries = Object.entries(deals);

  // 「仕入れた商品(used_bought)」の合計＝収支の仕入れ累計（/bought と一致させる）。送料も含める（指定なければ一律1000）。
  //  ★boughtTotalJpy = 仕入れ商品の総額（出品済みも含む全件）。これを収支の「仕入れ累計」に使う＝旧deals(無在庫等)を巻き込まない。
  //  boughtOnHandJpy = うち未出品分（参考・後方互換）。
  let boughtOnHandJpy = 0, boughtOnHandCount = 0;
  let boughtTotalJpy = 0, boughtTotalCount = 0;
  try {
    // used_bought 値は number(旧) or スナップショット(新)。送料は別ハッシュ used_ship:{id→円}（未設定は一律1000）。
    const [bought, ship] = await Promise.all([
      kv.hgetall<Record<string, unknown>>(`used_bought:${actor}`),
      kv.hgetall<Record<string, number>>(`used_ship:${actor}`),
    ]);
    for (const [id, v] of Object.entries(bought ?? {})) {
      const buy =
        typeof v === "number"
          ? v
          : Number((v as { buyJpy?: number })?.buyJpy) || Number((v as { source?: { price?: number } })?.source?.price) || 0;
      const sRaw = ship && ship[id] !== undefined ? Number(ship[id]) : 1000; // 送料：指定なければ一律1000円
      const cost = buy + (Number.isFinite(sRaw) ? sRaw : 1000);
      boughtTotalJpy += cost;
      boughtTotalCount += 1;
      if (!deals[id]) { boughtOnHandJpy += cost; boughtOnHandCount += 1; }
    }
  } catch {
    /* noop */
  }

  const sold = entries.filter(([, d]) => d.soldUsd != null).map(([, d]) => d); // 売却済み（実取引なので全部有効）
  // 出品中＝未売却 かつ 停止していない かつ 出品できた（SKU対応表にある or 公開IDあり）ものだけ。
  const live = entries.filter(([id, d]) => d.soldUsd == null && d.stoppedAt == null && (isPublished(id) || !!d.listingId)).map(([, d]) => d);
  const listedPurchase = live.reduce((a, d) => a + (d.purchase ?? 0), 0);

  let totalPurchase = 0;
  let totalSales = 0;
  let totalProfit = 0;
  let totalPoints = 0;
  let totalFees = 0;
  let bestProfit = 0;
  const byMonth = new Map<string, MonthPoint>();
  for (const d of sold) {
    const saleJpy = Math.round(Math.max(0, Number(d.soldUsd) || 0) * USD_JPY); // 不正値(NaN/負)で利益が汚染されないようクランプ
    const fee = Math.round(saleJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED;
    const profit = saleJpy - fee - d.purchase; // 現金利益（ポイントは含めない＝totalPoints で別集計）
    totalPurchase += d.purchase;
    totalSales += saleJpy;
    totalFees += fee;
    totalProfit += profit;
    totalPoints += d.points ?? 0;
    if (profit > bestProfit) bestProfit = profit;
    // 売却月で集計（soldAt が "YYYY-MM..." のときだけ）
    const ym = (d.soldAt ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) {
      const cur =
        byMonth.get(ym) ?? { month: ym, label: `${Number(ym.slice(5, 7))}月`, profit: 0, sales: 0, purchase: 0, count: 0 };
      cur.profit += profit;
      cur.sales += saleJpy;
      cur.purchase += d.purchase;
      cur.count += 1;
      byMonth.set(ym, cur);
    }
  }
  const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  return {
    soldCount: sold.length,
    listedCount: sold.length + live.length, // 実際に出品できたもの（出品中＋売却済み）。下書き等は含めない
    boughtOnHandJpy,
    boughtOnHandCount,
    boughtTotalJpy,
    boughtTotalCount,
    listedPurchase,
    totalPurchase,
    totalSales,
    totalProfit,
    totalPoints,
    totalFees,
    avgProfit: sold.length ? Math.round(totalProfit / sold.length) : 0,
    bestProfit,
    monthly,
  };
}
