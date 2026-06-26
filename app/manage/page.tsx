import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ArrowRight, ExternalLink, Heart, ShoppingBag, Tag, Lock } from "lucide-react";
import { getFavoriteItems, getBoughtItems, sourceSiteName } from "../lib/usedCatalog";
import { listDealsForUser } from "../lib/ebay/stats";
import { getActorId } from "../lib/auth/actor";
import { canAutoList, getCurrentUserEmail } from "../lib/auth/plan";
import { isAdmin } from "../lib/auth/admin";
import { kvReadOnly } from "../lib/kv";
import BottomNav from "../components/BottomNav";
import ManageTabs from "../components/ManageTabs";
import FavoriteHeart from "../components/FavoriteHeart";
import CatalogActionButtons from "../components/CatalogActionButtons";
import ListingHelper from "../components/ListingHelper";
import RemoveBoughtButton from "../components/RemoveBoughtButton";
import ShippingInput from "../components/ShippingInput";
import PriceTierEdit from "../components/PriceTierEdit";
import type { ProfitProduct } from "../lib/profitFilter";

export const dynamic = "force-dynamic"; // 自分の商品は毎回最新で

export const metadata: Metadata = {
  title: "商品管理｜お気に入り・仕入れ・出品中",
  robots: { index: false }, // 個人の商品管理は検索除外
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");
const USD_JPY = 155;

// 出品中の価格変更ボタン用の4段（±0育成 / 最安 / 中央値 / 高値）をUSDで算出。損益分岐は割らない。
function priceTiers(medianJpy: number, costJpy: number) {
  const floorJpy = Math.max(1, (costJpy + 47) / (1 - 0.1325)); // 損益分岐(手数料込・概算)
  const floor = floorJpy / USD_JPY;
  const median = medianJpy > 0 ? medianJpy / USD_JPY : 0;
  return {
    breakeven: Math.max(0.01, floor),
    low: median > 0 ? Math.max(floor, median * 0.9) : 0,
    median: median > 0 ? Math.max(floor, median) : 0,
    high: median > 0 ? Math.max(floor, median * 1.1) : 0,
  };
}

type Tab = "fav" | "bought" | "listed";

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "fav" || sp.tab === "listed" ? sp.tab : "bought";
  const actor = await getActorId();

  const [favItems, boughtItems, deals, canList, isAdminUser] = await Promise.all([
    getFavoriteItems(actor),
    getBoughtItems(actor),
    listDealsForUser(actor ?? ""),
    canAutoList(),
    getCurrentUserEmail().then((e) => isAdmin(e)),
  ]);
  const live = deals.live;
  const liveIds = new Set(live.map((d) => d.id));
  // 仕入れ商品＝「仕入れた」のうち、まだ出品中になっていないもの（出品したら出品中タブへ移る）。
  const boughtNotListed = boughtItems.filter((p) => !liveIds.has(p.id));
  const counts = { fav: favItems.length, bought: boughtNotListed.length, listed: live.length };

  // 出品中タブのみ：価格変更ボタン用に psnap(相場) を引いて4段を算出。
  let tiersById: Record<string, ReturnType<typeof priceTiers>> = {};
  if (tab === "listed" && live.length) {
    try {
      const snaps = (await kvReadOnly.mget(...live.map((d) => `psnap:${d.id}`))) as (
        { realMedianPrice?: number; realAvgPrice?: number; source?: { price?: number } } | null
      )[];
      live.forEach((d, i) => {
        const s = snaps[i];
        const medianJpy = Number(s?.realMedianPrice) || Number(s?.realAvgPrice) || 0;
        const costJpy = d.purchase || Number(s?.source?.price) || 0;
        tiersById[d.id] = priceTiers(medianJpy, costJpy);
      });
    } catch {
      /* psnap が引けなくても ±0 は cost から出せる */
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
          <ListedTab live={live} tiersById={tiersById} />
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
      <Empty Icon={Heart} title="まだお気に入りはありません" body="利益カタログでカード右上の♡を押すと、ここに入ります。" />
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
      <Empty Icon={ShoppingBag} title="まだ仕入れた商品はありません" body="利益カタログで「仕入れた」を押すと、ここに入って出品できます。" />
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
                {/* eBay自動出品はプロMAX限定。非対象はアップグレード導線。 */}
                {canList ? (
                  <ListingHelper product={p as ProfitProduct} />
                ) : (
                  <Link href="/pricing?from=bought" className="flex items-center justify-center gap-1.5 h-10 bg-[#2D323B] text-white font-bold text-[13px] rounded-xl ring-1 ring-[#A98B5C]/60 active:bg-[#1A1D23]">
                    <Lock size={14} className="text-[#A98B5C]" /> eBay自動出品は<b>プロMAX</b>限定 → プランを見る
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

// ── 出品中の商品 ────────────────────────────────────────────
function ListedTab({ live, tiersById }: { live: Awaited<ReturnType<typeof listDealsForUser>>["live"]; tiersById: Record<string, ReturnType<typeof priceTiers>> }) {
  if (live.length === 0) {
    return (
      <Empty Icon={Tag} title="出品中の商品はありません" body="「仕入れ商品」からeBay自動出品すると、ここに出品中として表示されます。" />
    );
  }
  return (
    <ol className="space-y-2.5">
      {live.map((d, i) => {
        const tiers = tiersById[d.id];
        return (
          <li key={`${d.id}-${i}`}>
            <div className="relative bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm overflow-hidden">
              <div className="flex items-start gap-3">
                <Thumb src={d.imageUrl} />
                <div className="flex-1 min-w-0">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0064D2]/10 text-[#0064D2] border border-[#0064D2]/20 mb-1">出品中</span>
                  <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{d.title}</p>
                  <p className="text-[11px] text-gray-500 mt-1 tabular-nums">仕入れ {yen(d.purchase)}</p>
                  {d.sourceStatus && (
                    <p className="text-[10px] text-amber-600 font-bold mt-0.5">⚠️ 仕入れ元が{d.sourceStatus === "soldout" ? "売り切れ" : "掲載終了"}</p>
                  )}
                </div>
              </div>

              <div className="mt-2.5 space-y-2">
                {tiers && <PriceTierEdit productId={d.id} tiers={tiers} />}
                {d.listingId && (
                  <a href={`https://www.ebay.com/itm/${d.listingId}`} target="_blank" rel="nofollow noopener noreferrer" className="flex items-center justify-center gap-1.5 h-9 bg-white border border-[#0064D2] text-[#0064D2] font-bold text-[12px] rounded-xl active:bg-[#0064D2]/5">
                    eBayの出品を見る <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Thumb({ src }: { src?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="w-16 h-16 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0" />
  ) : (
    <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0" />
  );
}

function Empty({ Icon, title, body }: { Icon: typeof Heart; title: string; body: string }) {
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
