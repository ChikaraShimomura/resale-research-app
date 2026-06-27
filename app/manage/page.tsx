import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ArrowRight, ExternalLink, Heart, ShoppingBag, Tag, Archive, Lock } from "lucide-react";
import { getFavoriteItems, getBoughtItems, sourceSiteName } from "../lib/usedCatalog";
import { listDealsForUser, getListingSku } from "../lib/ebay/stats";
import { getValidAccessToken } from "../lib/ebay/tokens";
import { getOfferForSku } from "../lib/ebay/listing";
import { skuForProduct } from "../lib/ebay/sellApi";
import { getTeamContext } from "../lib/auth/teamActor";
import { canAutoList, getCurrentUserEmail } from "../lib/auth/plan";
import { isAdmin } from "../lib/auth/admin";
import { kvReadOnly } from "../lib/kv";
import { landedCost, landedCostForWeight } from "../lib/ebay/landedCost";
import BottomNav from "../components/BottomNav";
import ManageTabs from "../components/ManageTabs";
import FavoriteHeart from "../components/FavoriteHeart";
import CatalogActionButtons from "../components/CatalogActionButtons";
import ListingHelper from "../components/ListingHelper";
import RemoveBoughtButton from "../components/RemoveBoughtButton";
import ShippingInput from "../components/ShippingInput";
import PriceTierEdit from "../components/PriceTierEdit";
import StopListingButton from "../components/StopListingButton";
import OptimizeButton from "../components/OptimizeButton";
import RemoteThumb from "../components/RemoteThumb";
import type { ProfitProduct } from "../lib/profitFilter";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic"; // 自分の商品は毎回最新で

export const metadata: Metadata = {
  title: "商品管理｜お気に入り・仕入れ・出品中",
  robots: { index: false }, // 個人の商品管理は検索除外
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");
const USD_JPY = 155;

// 出品中の価格変更ボタン用の4段（±0育成 / 最安 / 中央値 / 高値）をUSDで算出。損益分岐は割らない。
// ★損益分岐(floor)＝(仕入れ原価 ＋ eBay固定手数料¥47 ＋ 着地コスト) ÷ (1−eBay料率13.25%)。
//   着地コスト = landedCost(国際送料へのeBay手数料 ＋ $100超の米国関税前払い ＋ 送料不足)。
//   つまり ±0 も 最安/中央/高値 も「送料・関税・手数料を全て加味」した上で損益分岐を割らない（出品モーダルの floor と同一ロジック）。
function priceTiers(medianJpy: number, costJpy: number, category?: string, weightG?: number) {
  const median = medianJpy > 0 ? medianJpy / USD_JPY : 0;
  // 着地コストは「想定売価(中央値USD)」で見積もる。中央値が無ければ原価USDで概算。
  const valueUsd = median > 0 ? median : costJpy > 0 ? costJpy / USD_JPY : 1;
  // ★重量は「商品ごとのAI推定重量(weight:{id} キャッシュ)」を最優先＝出品モーダル(prepare)の floor と完全一致させる。
  //   未キャッシュ(モーダル未オープン)の品だけカテゴリ概算へフォールバック。これが無いと一覧とモーダルの ±0 がズレる。
  const landed = weightG && weightG > 0 ? landedCostForWeight(weightG, valueUsd) : landedCost(category, valueUsd);
  const floorJpy = Math.max(1, (costJpy + 47 + landed.subtractJpy) / (1 - 0.1325));
  const floor = floorJpy / USD_JPY;
  return {
    // 原価が分からない(0)時は ±0 もボタン無効化（near-free 価格の誤送信を防ぐ）。
    breakeven: costJpy > 0 ? Math.max(0.01, floor) : 0,
    low: median > 0 ? Math.max(floor, median * 0.9) : 0,
    median: median > 0 ? Math.max(floor, median) : 0,
    high: median > 0 ? Math.max(floor, median * 1.1) : 0,
  };
}

type Tab = "fav" | "bought" | "listed" | "ended";

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "fav" || sp.tab === "listed" || sp.tab === "ended" ? sp.tab : "bought";
  // チーム参加中は「共有データ＝オーナー名前空間」を読む（全員で同じ在庫/お気に入り/出品/収益）。
  const { dataActor: actor, ebayActor } = await getTeamContext();

  const [favItems, boughtItems, deals, canList, isAdminUser] = await Promise.all([
    getFavoriteItems(actor),
    getBoughtItems(actor),
    listDealsForUser(actor ?? ""),
    canAutoList(),
    getCurrentUserEmail().then((e) => isAdmin(e)),
  ]);
  // 出品中（live）＝出品中の商品タブ。停止中／過去（stopped/archived）＝終了商品タブ。
  // いずれも「出品済み」なので仕入れ商品(未出品)からは必ず外す＝出品済みなのに二重出品するのを防ぐ。
  const live = deals.live.map((d) => ({ ...d, _status: "live" as const }));
  const stopped = deals.stopped.map((d) => ({ ...d, _status: "stopped" as const }));
  const archived = deals.archived.map((d) => ({ ...d, _status: "archived" as const }));
  const endedAll = [...stopped, ...archived]; // 終了商品タブの中身
  const listedIds = new Set([...live, ...stopped, ...archived].map((d) => d.id));
  // 仕入れ商品＝「仕入れた」のうち、まだ一度も出品していないもの（出品/停止/過去はすべて除外）。
  const boughtNotListed = boughtItems.filter((p) => !listedIds.has(p.id));
  const counts = {
    fav: favItems.length,
    bought: boughtNotListed.length,
    listed: live.length + deals.sold.length, // 出品中＋売れた商品
    ended: endedAll.length, // 停止中＋過去の出品
  };

  // psnap(出品用スナップショット)：出品中タブは価格4段(live)、終了商品タブは再出品用の商品(stopped/archived)に使う。
  // アクティブなタブの分だけ引く（無駄な読み出しを避ける）。
  const tiersById: Record<string, ReturnType<typeof priceTiers>> = {};
  const snapById: Record<string, ProfitProduct> = {}; // 再出品(ListingHelper)に渡す商品スナップショット
  const needSnap = tab === "listed" ? live : tab === "ended" ? endedAll : [];
  if (needSnap.length) {
    try {
      // psnap(商品)と weight(商品ごとのAI推定梱包重量・prepareがキャッシュ)を同時取得＝±0をモーダルと一致させる材料。
      const [snaps, weights] = (await Promise.all([
        kvReadOnly.mget(...needSnap.map((d) => `psnap:${d.id}`)),
        kvReadOnly.mget(...needSnap.map((d) => `weight:${d.id}`)),
      ])) as [
        ((ProfitProduct & { realMedianPrice?: number; realAvgPrice?: number; source?: { price?: number } }) | null)[],
        (number | null)[],
      ];
      needSnap.forEach((d, i) => {
        const s = snaps[i];
        if (s && s.id && s.title) snapById[d.id] = s as ProfitProduct;
        if (d._status === "live") {
          const medianJpy = Number(s?.realMedianPrice) || Number(s?.realAvgPrice) || 0;
          const costJpy = d.purchase || Number(s?.source?.price) || 0;
          const w = typeof weights[i] === "number" && (weights[i] as number) > 0 ? (weights[i] as number) : undefined;
          tiersById[d.id] = priceTiers(medianJpy, costJpy, (s as { category?: string } | null)?.category, w);
        }
      });
    } catch {
      /* psnap が引けなくても ±0 は cost から出せる／再出品は不可表示 */
    }
  }

  // 出品中タブ：いま実際にeBayに出している価格を取得して表示（本人が変えた値も反映）。best-effort・並列。
  const priceById: Record<string, string> = {};
  if (tab === "listed" && live.length && ebayActor) {
    try {
      const token = await getValidAccessToken(ebayActor);
      if (token) {
        const results = await Promise.all(
          live.slice(0, 60).map(async (d) => {
            const sku = (await getListingSku(ebayActor, d.id)) ?? skuForProduct(d.id);
            const offer = await getOfferForSku(token, sku).catch(() => null);
            return [d.id, offer?.priceUsd] as const;
          })
        );
        for (const [id, price] of results) if (price) priceById[id] = price;
      }
    } catch {
      /* 価格が取れなくても出品中一覧は表示する */
    }
  }

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <span className="text-white font-black text-base tracking-tight">商品管理</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <ManageTabs active={tab} counts={counts} />

        {tab === "fav" && (
          <FavoritesTab items={favItems} canList={canList} isAdminUser={isAdminUser} />
        )}
        {tab === "bought" && (
          <BoughtTab items={boughtNotListed} canList={canList} />
        )}
        {tab === "listed" && (
          <ListedTab live={live} sold={deals.sold} tiersById={tiersById} priceById={priceById} />
        )}
        {tab === "ended" && (
          <EndedTab stopped={stopped} archived={archived} snapById={snapById} canList={canList} />
        )}
      </main>

      <BottomNav />
    </div>
  );
}

// ── お気に入り ─────────────────────────────────────────────
function FavoritesTab({ items, canList, isAdminUser }: { items: Awaited<ReturnType<typeof getFavoriteItems>>; canList: boolean; isAdminUser: boolean }) {
  if (items.length === 0) {
    return (
      <Empty Icon={Heart} title="まだお気に入りはありません" body={<><span className="whitespace-nowrap">利益カタログでカード右上の</span><wbr /><span className="whitespace-nowrap">♡を押すと、</span><wbr /><span className="whitespace-nowrap">ここに入ります。</span></>} />
    );
  }
  return (
    <ol className="space-y-2.5">
      {items.map((p, i) => {
        const buyJpy = p.source?.price ?? 0;
        return (
          <li key={`${p.id}-${i}`}>
            <div className="relative bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm overflow-hidden">
              <FavoriteHeart productId={p.id} initialFaved refreshOnChange />
              <div className="flex items-start gap-3 pr-9">
                <Thumb src={p.imageUrl} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{p.title}</p>
                  <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                    仕入れ {yen(buyJpy)} <span className="text-gray-300">→</span> eBay想定 <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span>
                  </p>
                  <p className="mt-1 inline-flex items-center gap-0.5 text-[#2D323B] font-black text-[13px]">
                    <Flame size={12} /> {p.realProfitRate}%
                    <span className="text-[11px] font-black text-[#A98B5C] ml-1.5 tabular-nums">+{yen(p.realProfit)}</span>
                  </p>
                </div>
              </div>
              <div className="mt-2.5 space-y-2">
                {p.source?.url && (
                  <a href={p.source.url} target="_blank" rel="nofollow noopener noreferrer" className="flex items-center justify-center gap-1.5 h-9 bg-white border border-[#2D323B]/30 text-[#2D323B] font-bold text-[12px] rounded-xl active:bg-gray-50">
                    {sourceSiteName(p.source?.site)}で見る <ExternalLink size={13} />
                  </a>
                )}
                <CatalogActionButtons productId={p.id} buyJpy={buyJpy} isAdmin={isAdminUser} canAutoList={canList} shareUrl={p.source?.url} shareTitle={p.title} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── 仕入れ商品（未出品） ─────────────────────────────────────
function BoughtTab({ items, canList }: { items: Awaited<ReturnType<typeof getBoughtItems>>; canList: boolean }) {
  if (items.length === 0) {
    return (
      <Empty Icon={ShoppingBag} title="まだ仕入れた商品はありません" body={<><span className="whitespace-nowrap">利益カタログで</span><wbr /><span className="whitespace-nowrap">「仕入れた」を押すと、</span><wbr /><span className="whitespace-nowrap">ここに入って出品できます。</span></>} />
    );
  }
  return (
    <ol className="space-y-2.5">
      {items.map((p, i) => {
        const buyJpy = p.buyJpy ?? p.source?.price ?? 0;
        return (
          <li key={`${p.id}-${i}`}>
            <div className="relative bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm overflow-hidden">
              <div className="flex items-start gap-3">
                <Thumb src={p.imageUrl} />
                <div className="flex-1 min-w-0">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1">仕入れ済み</span>
                  <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{p.title}</p>
                  <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                    仕入れ {yen(buyJpy)} <span className="text-gray-300">→</span> eBay想定 <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span>
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm"><Flame size={13} />{p.realProfitRate}%</span>
                  <p className="text-[9px] text-gray-400">利益率</p>
                  <p className="text-[11px] font-black text-[#A98B5C] mt-0.5 tabular-nums">+{yen(p.realProfit)}</p>
                </div>
              </div>

              <div className="mt-2.5 space-y-2">
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5">
                  <ShippingInput productId={p.id} buyJpy={buyJpy} initial={p.shippingJpy ?? 1000} />
                </div>
                {/* eBay自動出品は有料プラン（ライト以上）。free はアップグレード導線。 */}
                {canList ? (
                  <ListingHelper product={p as ProfitProduct} />
                ) : (
                  <Link href="/pricing?from=manage" className="flex items-center justify-center gap-1.5 h-11 bg-[#2D323B] text-white font-bold text-[13px] rounded-xl ring-1 ring-[#A98B5C]/60 active:bg-[#1A1D23]">
                    <Lock size={14} className="text-[#A98B5C]" /> プラン加入でeBay自動出品
                  </Link>
                )}
                {/* 「一覧から外す」と「仕入れ元で見る」を小さく横並び（ユーザー指示2026-06-27）。 */}
                <div className="flex items-center justify-end gap-2">
                  <RemoveBoughtButton productId={p.id} />
                  {p.source?.url && (
                    <a href={p.source.url} target="_blank" rel="nofollow noopener noreferrer" className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-gray-500 text-[11px] font-bold active:bg-gray-50">
                      {sourceSiteName(p.source?.site)}で見る <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── 出品中の商品タブ：出品中／売れた商品 の2セクション ──────────────────────
type ListedItem = Awaited<ReturnType<typeof listDealsForUser>>["live"][number] & { _status: "live" | "stopped" | "archived" };
type SoldItem = Awaited<ReturnType<typeof listDealsForUser>>["sold"][number];

function ListedTab({ live, sold, tiersById, priceById }: {
  live: ListedItem[]; sold: SoldItem[];
  tiersById: Record<string, ReturnType<typeof priceTiers>>;
  priceById: Record<string, string>;
}) {
  if (live.length + sold.length === 0) {
    return <Empty Icon={Tag} title="出品中の商品はありません" body={<><span className="whitespace-nowrap">「仕入れ商品」から</span><wbr /><span className="whitespace-nowrap">eBay自動出品すると、</span><wbr /><span className="whitespace-nowrap">ここに出品中として表示されます。</span></>} />;
  }
  return (
    <div className="space-y-5">
      {live.length > 0 && (
        <Section title="出品中" count={live.length} dot="bg-[#0064D2]">
          {live.map((d) => <LiveCard key={d.id} d={d} tiers={tiersById[d.id]} priceUsd={priceById[d.id]} />)}
        </Section>
      )}
      {sold.length > 0 && (
        <Section title="売れた商品" count={sold.length} dot="bg-emerald-500">
          {sold.map((d) => <SoldCard key={d.id} d={d} />)}
        </Section>
      )}
    </div>
  );
}

// ── 終了商品タブ：停止中／過去の出品 の2セクション（どちらも再出品できる） ──────────────────────
function EndedTab({ stopped, archived, snapById, canList }: {
  stopped: ListedItem[]; archived: ListedItem[];
  snapById: Record<string, ProfitProduct>; canList: boolean;
}) {
  if (stopped.length + archived.length === 0) {
    return <Empty Icon={Archive} title="終了した商品はありません" body={<><span className="whitespace-nowrap">出品を終了・停止すると、</span><wbr /><span className="whitespace-nowrap">ここに移ります。</span><wbr /><span className="whitespace-nowrap">再出品もできます。</span></>} />;
  }
  return (
    <div className="space-y-5">
      {stopped.length > 0 && (
        <Section title="停止中" count={stopped.length} dot="bg-amber-500" note={<><span className="whitespace-nowrap">24時間後に</span><wbr /><span className="whitespace-nowrap">「過去の出品」へ移ります。</span></>}>
          {stopped.map((d) => <RelistCard key={d.id} d={d} snap={snapById[d.id]} canList={canList} />)}
        </Section>
      )}
      {archived.length > 0 && (
        <Section title="過去の出品" count={archived.length} dot="bg-gray-400" note={<><span className="whitespace-nowrap">24時間後に</span><wbr /><span className="whitespace-nowrap">自動で削除されます。</span></>}>
          {archived.map((d) => <RelistCard key={d.id} d={d} snap={snapById[d.id]} canList={canList} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, dot, note, children }: { title: string; count: number; dot: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
        <h2 className="text-[13px] font-black text-gray-800">{title}</h2>
        <span className="text-[11px] text-gray-400 font-bold">{count}</span>
      </div>
      {note && <p className="text-[10px] text-gray-400 mb-2 leading-snug">{note}</p>}
      <ol className="space-y-2.5">{children}</ol>
    </section>
  );
}

// 出品中：現在の出品価格＋価格4段変更＋最適化＋出品終了。
function LiveCard({ d, tiers, priceUsd }: { d: ListedItem; tiers?: ReturnType<typeof priceTiers>; priceUsd?: string }) {
  const priceNum = Number(priceUsd) || 0;
  return (
    <li>
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm overflow-hidden">
        <div className="flex items-start gap-3">
          <Thumb src={d.imageUrl} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{d.title}</p>
            <p className="text-[11px] text-gray-500 mt-1 tabular-nums">仕入れ {yen(d.purchase)}</p>
            {/* いま実際にeBayに出している価格（取得できた時のみ）。¥は概算（×155）。 */}
            {priceNum > 0 && (
              <p className="text-[12px] mt-1 tabular-nums">
                <span className="text-gray-400">現在の出品価格 </span>
                <span className="font-black text-[#0064D2]">約{yen(Math.round(priceNum * USD_JPY))}</span>
                <span className="text-gray-400 text-[10px]"> （${priceNum.toFixed(2)}）</span>
              </p>
            )}
            {d.sourceStatus && (
              <p className="text-[10px] text-amber-600 font-bold mt-0.5">⚠️ 仕入れ元が{d.sourceStatus === "soldout" ? "売り切れ" : "掲載終了"}</p>
            )}
          </div>
        </div>
        <div className="mt-2.5 space-y-2">
          {tiers && <PriceTierEdit productId={d.id} tiers={tiers} />}
          <OptimizeButton productId={d.id} />
          {/* 出品を終了する／eBayの出品を見る を横並び */}
          <div className="flex items-start gap-2">
            <div className="flex-1"><StopListingButton productId={d.id} /></div>
            {d.listingId && (
              <a href={`https://www.ebay.com/itm/${d.listingId}`} target="_blank" rel="nofollow noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-white border border-[#0064D2] text-[#0064D2] font-bold text-[12px] rounded-xl active:bg-[#0064D2]/5">
                eBayの出品を見る <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// 売れた商品：売値と利益を表示（読み取り専用）。
function SoldCard({ d }: { d: SoldItem }) {
  return (
    <li>
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm">
        <div className="flex items-start gap-3">
          <Thumb src={d.imageUrl} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{d.title}</p>
            <p className="text-[11px] text-gray-500 mt-1 tabular-nums">仕入れ {yen(d.purchase)} <span className="text-gray-300">→</span> 売れた {yen(d.soldJpy)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-[13px] font-black tabular-nums ${d.profitJpy < 0 ? "text-red-500" : "text-emerald-600"}`}>{d.profitJpy < 0 ? "−" : "+"}{yen(Math.abs(d.profitJpy))}</p>
            <p className="text-[9px] text-gray-400">利益</p>
          </div>
        </div>
      </div>
    </li>
  );
}

// 停止中／過去の出品：再出品（ListingHelperで再公開）。
function RelistCard({ d, snap, canList }: { d: ListedItem; snap?: ProfitProduct; canList: boolean }) {
  return (
    <li>
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm">
        <div className="flex items-start gap-3">
          <Thumb src={d.imageUrl} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{d.title}</p>
            <p className="text-[11px] text-gray-500 mt-1 tabular-nums">仕入れ {yen(d.purchase)}</p>
            {d.sourceStatus && (
              <p className="text-[10px] text-amber-600 font-bold mt-0.5">⚠️ 仕入れ元が{d.sourceStatus === "soldout" ? "売り切れ" : "掲載終了"}</p>
            )}
          </div>
        </div>
        <div className="mt-2.5 space-y-2">
          {snap && canList && <ListingHelper product={snap} defaultListed={false} relist />}
          {snap && !canList && <p className="text-[11px] text-gray-400 text-center">再出品にはプラン加入が必要です。</p>}
          {!snap && <p className="text-[11px] text-gray-400 text-center">再出品データを準備中です。時間をおいて再度開いてください。</p>}
          {d.listingId && (
            <a href={`https://www.ebay.com/itm/${d.listingId}`} target="_blank" rel="nofollow noopener noreferrer" className="flex items-center justify-center gap-1.5 h-9 bg-white border border-[#0064D2] text-[#0064D2] font-bold text-[12px] rounded-xl active:bg-[#0064D2]/5">
              eBayの出品を見る <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function Thumb({ src }: { src?: string }) {
  return <RemoteThumb src={src} className="w-16 h-16 rounded-lg border border-[#A98B5C]/25 shrink-0" />;
}

function Empty({ Icon, title, body }: { Icon: typeof Heart; title: string; body: ReactNode }) {
  return (
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
      <Icon size={40} className="mx-auto mb-3 text-gray-300" />
      <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>
      <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">{body}</p>
      <Link href="/catalog" className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
        利益カタログを見る <ArrowRight size={16} />
      </Link>
    </div>
  );
}
