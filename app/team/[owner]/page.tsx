import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ExternalLink, Lock, ArrowRight } from "lucide-react";
import { getActorId } from "../../lib/auth/actor";
import { getCurrentUserEmail } from "../../lib/auth/plan";
import { isTeamMember, getMyTeams, getTeamName, getMemberPerms, getTeamMode } from "../../lib/team";
import { getBoughtItems, sourceSiteName } from "../../lib/usedCatalog";
import { getStats } from "../../lib/ebay/stats";
import BottomNav from "../../components/BottomNav";
import ListingHelper from "../../components/ListingHelper";
import RemoveBoughtButton from "../../components/RemoveBoughtButton";
import ShippingInput from "../../components/ShippingInput";
import type { ProfitProduct } from "../../lib/profitFilter";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チーム共有", robots: { index: false } };

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

export default async function TeamOwnerPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: ownerRaw } = await params;
  const ownerActor = decodeURIComponent(ownerRaw || "");
  const viewer = await getActorId();

  // 権限ゲート：オーナー本人 or 名簿メンバーだけ。共有は財務を含むので必ずサーバーで確認。
  const allowed = await isTeamMember(viewer, ownerActor);
  if (!allowed) {
    return (
      <div className="min-h-dvh bg-[#F5F7FA] flex items-center justify-center px-4 pb-nav">
        <div className="w-full max-w-md bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
          <Lock size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-bold text-gray-700 mb-1">閲覧権限がありません</p>
          <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">このチームのメンバーとして承認されている必要があります。</p>
          <Link href="/team" className="inline-flex items-center h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]">
            チームへ
          </Link>
        </div>
        <BottomNav />
      </div>
    );
  }

  // オーナー表示名（自分のチームなら自分のメール、他人なら参加チーム一覧から引く）。チーム名があれば優先表示。
  let ownerEmail = "";
  if (viewer === ownerActor) ownerEmail = (await getCurrentUserEmail()) || "あなた";
  else ownerEmail = (await getMyTeams(viewer || "")).find((t) => t.ownerActor === ownerActor)?.ownerEmail || "メンバー";
  const teamName = await getTeamName(ownerActor);
  const teamLabel = teamName || `${ownerEmail} のチーム`;

  // 権限とモード。オーナー本人は全権限。共有モードのみアクション可（個別モードは読み取り専用）。
  const [items, s, perms, mode] = await Promise.all([
    getBoughtItems(ownerActor),
    getStats(ownerActor),
    getMemberPerms(ownerActor, viewer || ""),
    getTeamMode(ownerActor),
  ]);
  const isOwner = viewer === ownerActor;
  const shared = mode === "shared";
  // 操作可否は権限のみで決まる（どちらの方式でもメンバーは権限に応じて操作できる）。方式は出品に使うeBayアカウントの違いだけ。
  const can = (p: string) => isOwner || perms.includes(p as never);
  const canFinance = can("finance");
  const canBuy = can("buy");
  const canList = can("list");
  const canDelete = can("delete");
  const canShipping = can("shipping");
  const anyAction = canList || canDelete || canShipping;

  const totalBuy = s.boughtTotalJpy; // 仕入れ商品の合計（送料込）＝共有相手の仕入れ一覧と一致
  const netCash = s.totalSales - s.totalFees - totalBuy;

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link href="/team" aria-label="チームへ" className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95">
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight truncate">{teamLabel}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        {/* モード表示＋仕入れCTA（共有モード・buy権限のみ） */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-[11px] font-bold ${shared ? "bg-[#A98B5C]/15 text-[#7A6336]" : "bg-gray-100 text-gray-600"}`}>
            {shared ? "共有：オーナーのeBayで出品" : "個別：各自のeBayで出品"}
          </span>
          {canBuy && (
            <Link
              href={`/catalog?team=${encodeURIComponent(ownerActor)}`}
              className="inline-flex items-center gap-1 h-9 px-3 bg-[#2D323B] text-white text-[12px] font-bold rounded-xl active:bg-[#1A1D23]"
            >
              カタログから仕入れる <ArrowRight size={13} />
            </Link>
          )}
        </div>

        {/* 収支（finance権限のあるメンバー＝オーナーには常に表示） */}
        {canFinance && (
          <section className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm mb-4">
            <p className="text-[13px] font-black text-gray-800 mb-1">収支（仕入れ ↔ 売上）</p>
            <p className="text-[11px] text-gray-400 mb-3">{ownerEmail} さんの「仕入れた」と自動出品の売上</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-500">仕入れ累計</span>
                <span className="text-[13px] font-bold text-gray-700 tabular-nums">− {yen(totalBuy)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-500">売上累計（{s.soldCount}件売れた）</span>
                <span className="text-[13px] font-bold text-[#0064D2] tabular-nums">+ {yen(s.totalSales)}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#A98B5C]/25 flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-gray-700">差引（現金）</span>
              <span className={`text-lg font-black tabular-nums ${netCash < 0 ? "text-[#2D323B]" : "text-emerald-600"}`}>
                {(netCash < 0 ? "− " : "") + "¥" + Math.abs(Math.round(netCash)).toLocaleString("ja-JP")}
              </span>
            </div>
            {!shared && (
              <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">※ 個別モードでは各メンバーの売上は各自のeBayアカウントに計上され、この収支（オーナー分）には含まれません。</p>
            )}
          </section>
        )}

        <h2 className="text-sm font-black text-gray-800 mb-2">仕入れた商品（{items.length}）</h2>
        {items.length === 0 ? (
          <p className="text-[12px] text-gray-400">まだ仕入れた商品はありません。</p>
        ) : (
          <ol className="space-y-2.5">
            {items.map((p, i) => {
              const buyJpy = p.buyJpy ?? p.source?.price ?? 0;
              return (
                <li key={`${p.id}-${i}`}>
                  <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm">
                    <div className="flex items-start gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">{p.title}</p>
                        <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                          仕入れ {yen(buyJpy)} <span className="text-gray-300">→</span> eBay想定{" "}
                          <span className="text-[#0064D2] font-bold">{yen(p.realAvgPrice)}</span>
                        </p>
                        {p.source?.url && (
                          <a href={p.source.url} target="_blank" rel="nofollow noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-[#2D323B]">
                            {sourceSiteName(p.source.site)}で見る <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm">
                          <Flame size={13} />
                          {p.realProfitRate}%
                        </span>
                        <p className="text-[9px] text-gray-400">利益率</p>
                        <p className="text-[11px] font-black text-[#A98B5C] mt-0.5 tabular-nums">+{yen(p.realProfit)}</p>
                      </div>
                    </div>

                    {/* アクション（共有モード＋権限あり）。オーナー名義で実行される。 */}
                    {anyAction && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#A98B5C]/20 space-y-2">
                        {canShipping && (
                          <ShippingInput productId={p.id} buyJpy={buyJpy} initial={p.shippingJpy ?? 1000} teamOwner={ownerActor} />
                        )}
                        {(canList || canDelete) && (
                          <div className="flex items-center gap-2">
                            {canList && <ListingHelper product={p} onBehalfOf={ownerActor} />}
                            {canDelete && <RemoveBoughtButton productId={p.id} teamOwner={ownerActor} />}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-4 text-[10px] text-gray-400 leading-relaxed">
          {shared
            ? "※ 共有モード：在庫・収支を共有し、出品はオーナーの1つのeBayアカウント（オーナーのプラン枠）で行います。"
            : "※ 個別モード：在庫・収支を共有しつつ、出品は各メンバー自身が連携したeBayアカウントで行います。"}
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
