import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ExternalLink, Lock } from "lucide-react";
import { getActorId } from "../../lib/auth/actor";
import { getCurrentUserEmail } from "../../lib/auth/plan";
import { isTeamMember, getMyTeams } from "../../lib/team";
import { getBoughtItems, sourceSiteName } from "../../lib/usedCatalog";
import { getStats } from "../../lib/ebay/stats";
import BottomNav from "../../components/BottomNav";

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

  // オーナー表示名（自分のチームなら自分のメール、他人なら参加チーム一覧から引く）。
  let ownerEmail = "";
  if (viewer === ownerActor) ownerEmail = (await getCurrentUserEmail()) || "あなた";
  else ownerEmail = (await getMyTeams(viewer || "")).find((t) => t.ownerActor === ownerActor)?.ownerEmail || "メンバー";

  const [items, s] = await Promise.all([getBoughtItems(ownerActor), getStats(ownerActor)]);
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
          <span className="text-white font-black text-base tracking-tight truncate">{ownerEmail} のチーム</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        {/* 収支（共有・読み取り専用） */}
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
        </section>

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
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-4 text-[10px] text-gray-400 leading-relaxed">※ 共有は読み取り専用です。出品はオーナー本人のみ行えます。</p>
      </main>

      <BottomNav />
    </div>
  );
}
