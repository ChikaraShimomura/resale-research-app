import type { Metadata } from "next";
import Link from "next/link";
import { Flame, ArrowRight, Lock, ExternalLink, ArrowUpDown, Tag } from "lucide-react";
import { getUsedCatalog, conditionLabel, ebaySoldSearchUrl, sourceSiteName, getHiddenCatalogKeys, getFavoriteKeys, catalogItemKey, isProhibited } from "../lib/usedCatalog";
import type { UsedCatalogItem } from "../lib/usedCatalog";
import { canViewCatalog, getCurrentUserEmail, canAutoList } from "../lib/auth/plan";
import { getActorId } from "../lib/auth/actor";
import { isAdmin } from "../lib/auth/admin";
import { hasPerm, getTeamName } from "../lib/team";
import BottomNav from "../components/BottomNav";
import CatalogActionButtons from "../components/CatalogActionButtons";
import FavoriteHeart from "../components/FavoriteHeart";
import RemoteThumb from "../components/RemoteThumb";

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

// 並べ替えオプション（?sort= の値→ラベル＋比較関数）。既定は利益額の高い順。
const SORTS: Record<string, { label: string; cmp: (a: UsedCatalogItem, b: UsedCatalogItem) => number }> = {
  profit: { label: "利益額", cmp: (a, b) => b.profitJpy - a.profitJpy },
  rate: { label: "利益率", cmp: (a, b) => b.profitRate - a.profitRate },
  cheap: { label: "仕入れ安い", cmp: (a, b) => a.buyJpy - b.buyJpy },
  demand: { label: "売れ筋", cmp: (a, b) => (b.soldCount || 0) - (a.soldCount || 0) || b.profitJpy - a.profitJpy },
};
const SORT_KEYS = ["profit", "rate", "cheap", "demand"];
const pillCls = (active: boolean) =>
  `shrink-0 h-8 px-3 inline-flex items-center rounded-full text-[12px] font-bold border ${
    active ? "bg-[#2D323B] text-white border-[#2D323B]" : "bg-white text-gray-600 border-[#A98B5C]/30 active:bg-gray-50"
  }`;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ sort?: string; genre?: string; team?: string }> }) {
  const sp = await searchParams;
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : "profit";
  const genre = sp.genre || "all";
  const canView = await canViewCatalog();
  const actor = await getActorId();
  const isAdminUser = isAdmin(await getCurrentUserEmail()); // 管理者だけ「これは無理」表記、他は「非表示(無理と判断)」表記
  const canList = await canAutoList(); // 自動出品=有料プラン(ライト以上)。在庫ありの無在庫はサーバーで別途プロMAXゲート(canDropship)
  // チーム共有：?team=オーナーactor。仕入れ権限を持つメンバーが押すと「仕入れた」がオーナーの一覧に入る。
  //   サーバーで権限を必ず再確認（URL改ざん対策）。権限がなければ通常モード（自分の一覧）に落とす。
  const teamReq = sp.team ? decodeURIComponent(sp.team) : "";
  const teamOwner = teamReq && actor && (await hasPerm(teamReq, actor, "buy")) ? teamReq : "";
  const teamName = teamOwner ? (await getTeamName(teamOwner)) || "チーム" : "";
  // このユーザーが「仕入れた」「これは無理」で外した商品は一覧から差し引く（per-actorのtriage）。
  // ♡お気に入りはカードの♡初期状態に使う（カタログからは隠さない）。
  const [hidden, favKeys] = await Promise.all([getHiddenCatalogKeys(actor), getFavoriteKeys(actor)]);
  // 表示対象：同一型番の実落札で相場確定（ebayConfirmed）＋利益率5%以上＋本人が外した品/発送不可(危険物)は除外。
  //   ※ジャンク品は掲載する（ユーザー指示2026-06-27）。状態はカードにランク表示＋出品時の説明文で明示。
  const base = (await getUsedCatalog()).filter(
    (p) => p.ebayConfirmed && p.profitRate >= 5 && !hidden.has(catalogItemKey(p)) && !isProhibited(`${p.brand} ${p.name}`)
  );
  // ジャンル一覧（件数つき・多い順）。?genre= で絞り込む。
  const genreCounts = base.reduce<Record<string, number>>((m, p) => { const c = p.cat || "中古"; m[c] = (m[c] || 0) + 1; return m; }, {});
  const genres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]);
  const items = (genre === "all" ? base : base.filter((p) => (p.cat || "中古") === genre)).sort(SORTS[sort].cmp);
  // 並べ替え/ジャンルのリンク（互いのクエリを保持）。
  const qs = (o: { sort?: string; genre?: string }) => {
    const g = o.genre ?? genre;
    const s = o.sort ?? sort;
    const params = new URLSearchParams();
    if (g && g !== "all") params.set("genre", g);
    if (s && s !== "profit") params.set("sort", s);
    if (teamOwner) params.set("team", teamOwner); // チームモードを並べ替え/ジャンル遷移でも維持
    const str = params.toString();
    return str ? `/catalog?${str}` : "/catalog";
  };

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
        {teamOwner && (
          <div className="mb-3 flex items-center justify-between gap-2 bg-[#A98B5C]/10 border border-[#A98B5C]/30 rounded-xl px-3 py-2">
            <p className="text-[12px] font-bold text-[#7A6336] leading-snug">
              「{teamName}」として仕入れ中<span className="block text-[10px] font-normal text-[#7A6336]/80">「仕入れた」はオーナーの一覧に入ります</span>
            </p>
            <Link href={`/team/${encodeURIComponent(teamOwner)}`} className="shrink-0 text-[11px] font-bold text-[#2D323B] underline">
              チームへ戻る
            </Link>
          </div>
        )}
        <h1 className="text-xl font-black text-gray-900 leading-snug mb-2">eBayで儲かる中古の型番</h1>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-1">
          <b>eBayで売れている型番</b>を、日本の<b>中古サイト</b>の現在価格と突合。
          <b>仕入れ値 → eBay想定売値（直近落札）→ 純利益</b>を、<b>状態ランク</b>つきで表示。
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
          ※ 純利益＝eBay想定売値 −（eBay手数料・国際送料・米国関税・仕入れ値）。中古は1点物のため在庫は流動的。状態・競合・為替で変動。
        </p>

        {/* ジャンル絞り込み（?genre=）。2ジャンル以上ある時だけ出す。サーバー側でフィルタ＝マスク/漏洩対策を維持。 */}
        {genres.length > 1 && (
          <div className="mb-2 -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
            <Tag size={14} className="text-gray-400 shrink-0" aria-hidden="true" />
            <Link href={qs({ genre: "all" })} scroll={false} aria-current={genre === "all" ? "true" : undefined} className={pillCls(genre === "all")}>
              すべて
            </Link>
            {genres.map((g) => (
              <Link key={g} href={qs({ genre: g })} scroll={false} aria-current={genre === g ? "true" : undefined} className={pillCls(genre === g)}>
                {g}（{genreCounts[g]}）
              </Link>
            ))}
          </div>
        )}

        {/* 並べ替え（サーバー側＝マスク/画像漏洩対策の描画を保ったまま ?sort= で順序だけ変える）。 */}
        {items.length > 0 && (
          <div className="mb-4 -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
            <ArrowUpDown size={14} className="text-gray-400 shrink-0" aria-hidden="true" />
            {SORT_KEYS.map((k) => (
              <Link key={k} href={qs({ sort: k })} scroll={false} aria-current={k === sort ? "true" : undefined} className={pillCls(k === sort)}>
                {SORTS[k].label}
              </Link>
            ))}
          </div>
        )}

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
                      {/* 仕入れ元の画像はリンク参照（再ホストしない・ホットリンク）。失効時はRemoteThumbがプレースホルダに差し替え。 */}
                      <RemoteThumb
                        src={!locked ? p.imageUrl : undefined}
                        alt={`${p.brand} ${p.name}`.trim()}
                        className="w-16 h-16 rounded-lg border border-[#A98B5C]/25 shrink-0"
                      />

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
                        {/* 競合数＝同等品のeBay現在出品総数(概算)。出品前の「狙い目/多め」を一目で。文言/色は EbayListingModal と統一。未取得は非表示。 */}
                        {!locked && p.ebayActiveCount != null && (
                          <p className="text-[10px] mt-0.5 leading-snug">
                            {p.ebayActiveCount <= 5 ? (
                              <span className="text-green-700 font-bold">🟢 競合 約{p.ebayActiveCount}件・少なめ（狙い目）</span>
                            ) : p.ebayActiveCount <= 30 ? (
                              <span className="text-gray-400">eBay競合 約{p.ebayActiveCount}件</span>
                            ) : (
                              <span className="text-amber-600 font-bold">🟠 競合 約{p.ebayActiveCount}件・多め</span>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        {/* ♡お気に入り（右上）。閲覧可のユーザーのみ。押すと /favorites に入る（カタログからは消えない）。 */}
                        {!locked && (
                          <FavoriteHeart productId={catalogItemKey(p)} initialFaved={favKeys.has(catalogItemKey(p))} className="relative" />
                        )}
                        <div>
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
                            {sourceSiteName(p.site)}で見る <ExternalLink size={14} />
                          </a>
                          {/* eBay落札の根拠。型番(ハイフン空白化)で検索＝特定型番の落札。古い保存URL(p.ebaySoldUrl)は "-"入りで該当が出ないので使わず、毎回 ebaySoldSearchUrl で生成する。 */}
                          <a
                            href={ebaySoldSearchUrl(p)}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 h-10 bg-white border border-[#0064D2] text-[#0064D2] font-bold text-[13px] rounded-xl active:bg-[#0064D2]/5"
                          >
                            eBay落札を確認 <ExternalLink size={14} />
                          </a>
                        </div>
                        {/* triage：仕入れたら / 無理なら 印を付ける（per-actor）＋共有でリンクを送る。「仕入れた」を押すと「仕入れ商品」へ入り、そこでeBay出品する。
                            チームモード（teamOwner）の時はオーナーの一覧へ入る。 */}
                        <CatalogActionButtons
                          productId={catalogItemKey(p)}
                          buyJpy={p.buyJpy}
                          isAdmin={isAdminUser}
                          canAutoList={canList}
                          teamOwner={teamOwner || undefined}
                          shareUrl={p.hardoffUrl}
                          shareTitle={`${p.brand} ${p.name}`.trim()}
                        />
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
