import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ArrowRight, Lock, ExternalLink } from "lucide-react";
import { getUsedCatalog, conditionLabel, ebaySoldSearchUrl, toListingProduct, isJunk } from "../lib/usedCatalog";
import { canViewCatalog } from "../lib/auth/plan";
import BottomNav from "../components/BottomNav";
import ListingHelper from "../components/ListingHelper";

export const dynamic = "force-dynamic"; // KVの最新カタログで毎回配信

const TITLE = "中古の利益カタログ｜eBay輸出で儲かる型番";
const DESC =
  "eBayで売れている型番を、日本の中古サイト（ハードオフ等）の現在価格と突合。送料・関税・手数料を引いた純利益と状態ランクつきで、いま仕入れて利益が出る中古品を一覧。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/catalog" },
};

const yen = (n: number) => "¥" + Math.round(n || 0).toLocaleString("ja-JP");

const toneCls = (tone: "good" | "mid" | "risk") =>
  tone === "good"
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : tone === "risk"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

export default async function CatalogPage() {
  const canView = await canViewCatalog();
  // ★同一型番のeBay実落札で相場が取れた商品だけ表示（ebayConfirmed）＋ジャンク(動作未確認)は除外（相場と前提が合わない）。
  const items = (await getUsedCatalog()).filter((p) => p.ebayConfirmed && !isJunk(p.condition));

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">
      <header
        className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] shadow-sm sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-3 py-2.5 flex items-center gap-2 max-w-2xl mx-auto">
          <Link
            href="/"
            aria-label="トップへ"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold shrink-0 active:scale-95"
          >
            ‹
          </Link>
          <span className="text-white font-black text-base tracking-tight">中古の利益カタログ</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        <h1 className="text-xl font-black text-gray-900 leading-snug mb-2">eBayで儲かる中古の型番</h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
          <b>eBayで売れている型番</b>を、日本の<b>中古サイト</b>の現在価格と突合。
          <b>仕入れ値 → eBay想定売値（直近落札）→ 純利益</b>を、<b>状態ランク</b>つきで表示。
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
          ※ 純利益＝eBay想定売値 −（eBay手数料・国際送料・米国関税・仕入れ値）。中古は1点物のため在庫は流動的。状態・競合・為替で変動。
        </p>

        {items.length === 0 ? (
          <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-gray-700 mb-1">同一型番の相場を再取得中</p>
            <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">eBayで<b>同じ型番の実落札だけ</b>を集めて利益を再計算しています（別モデルの価格を混ぜないため）。正確な相場が取れた商品から順に表示されます。</p>
            <Link
              href={canView ? "/" : "/pricing?from=catalog"}
              className="inline-flex items-center gap-1.5 h-11 px-6 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23]"
            >
              {canView ? (
                <>トップへ <ArrowRight size={16} /></>
              ) : (
                <><Lock size={15} className="text-[#A98B5C]" aria-hidden="true" /> プランで全部見る</>
              )}
            </Link>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {items.map((p, i) => {
              const locked = !canView;
              const cond = conditionLabel(p.condition);
              return (
                <li key={`${p.modelKey}-${i}`}>
                  <div className="relative bg-white border border-[#A98B5C]/25 rounded-2xl p-3 shadow-sm overflow-hidden">
                    <div className="flex items-start gap-3">
                      {p.imageUrl && !locked ? (
                        // 仕入れ元の画像はリンク参照（再ホストしない・ホットリンク）。
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="w-16 h-16 object-cover rounded-lg border border-[#A98B5C]/25 shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0" />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${toneCls(cond.tone)}`}>
                            {cond.rank ? `${cond.rank}（${cond.label}）` : cond.label}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#2D323B]/[0.06] text-[#2D323B] border border-[#A98B5C]/25">
                            {p.cat}
                          </span>
                        </div>
                        <p className="text-[12px] font-bold text-gray-800 leading-snug line-clamp-2">
                          {p.brand} {p.name}
                          {!locked && p.code ? <span className="text-gray-400 font-normal">（{p.code}）</span> : null}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                          {locked ? (
                            <>仕入れ <span className="text-gray-400">●●●</span> <span className="text-gray-300">→</span> eBay想定 <span className="text-gray-400">●●●</span></>
                          ) : (
                            <>仕入れ {yen(p.buyJpy)} <span className="text-gray-300">→</span> eBay想定 <span className="text-[#0064D2] font-bold">{yen(p.ebayMedianJpy)}</span></>
                          )}
                        </p>
                        {!locked && (
                          <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">
                            {p.ebayConfirmed ? (
                              <>eBay落札ベース{p.soldCount ? `・直近${p.soldCount}件` : ""}<span className="text-emerald-600 font-bold">（型番一致）</span></>
                            ) : (
                              <>eBay落札ベース（系列の目安・<span className="text-[#0064D2]">型番はリンクで確認↓</span>）</>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-flex items-center gap-0.5 text-[#2D323B] font-black text-sm">
                          <Flame size={13} />
                          {p.profitRate}%
                        </span>
                        <p className="text-[9px] text-gray-400">利益率</p>
                        {!locked && (
                          <p className="text-[11px] font-black text-[#A98B5C] mt-0.5 tabular-nums">+{yen(p.profitJpy)}</p>
                        )}
                      </div>
                    </div>

                    {/* 仕入れ先＋eBay落札の根拠＋自分でeBay自動出品（actionable＝有料のみ）。1点物なので個別URLへ直接。 */}
                    {!locked ? (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex gap-2">
                          <a
                            href={p.hardoffUrl}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 h-10 bg-[#2D323B] text-white font-bold text-[13px] rounded-xl active:bg-[#1A1D23]"
                          >
                            ハードオフで見る <ExternalLink size={14} />
                          </a>
                          {/* eBay落札の根拠。型番一致(confirmed)＝リファイナが実落札を返したクエリ、未確定＝ブランド+ライン名で必ず結果が出る。 */}
                          <a
                            href={p.ebayConfirmed && p.ebaySoldUrl ? p.ebaySoldUrl : ebaySoldSearchUrl(p)}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 h-10 bg-white border border-[#0064D2] text-[#0064D2] font-bold text-[13px] rounded-xl active:bg-[#0064D2]/5"
                          >
                            eBay落札を確認 <ExternalLink size={14} />
                          </a>
                        </div>
                        {/* 自分でeBayへ自動出品（仕入れて実物写真に差し替えてから出すのが前提）。実データは psnap:{id} を prepare が読む。 */}
                        <ListingHelper product={toListingProduct(p)} />
                      </div>
                    ) : (
                      <Link
                        href="/pricing?from=catalog"
                        className="mt-2.5 flex items-center justify-center gap-1.5 h-10 bg-[#2D323B]/95 text-white font-bold text-[13px] rounded-xl ring-1 ring-[#A98B5C]/60 active:bg-[#1A1D23]"
                      >
                        <Lock size={13} className="text-[#A98B5C]" aria-hidden="true" /> 仕入れ先はプランで解放
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
