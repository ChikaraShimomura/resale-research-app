"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import { fetchProducts } from "../lib/products";
import { ProfitProduct } from "../lib/profitFilter";
import { SortOrder, sortProducts } from "../components/SortSelect";
import ListControls from "../components/ListControls";
import { fetchSoldIds } from "../lib/ebaySold";
import { readListedIds, pinRestoredFirst } from "../lib/unlocked";
import { fetchListedIds } from "../lib/ebayListed";
import { readSort, writeSort } from "../lib/prefs";
import { logEvent } from "../lib/analytics";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import { Flame, PackageSearch, Search } from "lucide-react";

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";

  const [allProducts, setAllProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  // 既定=総合おすすめ順（利幅×需要×手頃さ×ライバルのバランス）。新着順は選択肢に残す。
  const [sortOrder, setSortOrder] = useState<SortOrder>("recommended");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // 自分がeBayで売れた商品ID（端末単位）。最下部化/非表示に使う。
  const [soldIds, setSoldIds] = useState<Set<string>>(new Set());
  // 自分がeBayに出品済みの商品ID。本人の検索結果からは隠して「出品中一覧へ移った」状態にする。
  // listedIds=この端末(localStorage)／accountListedIds=アカウント(サーバー・別端末でも効く)。両方で隠す。
  const [listedIds, setListedIds] = useState<Set<string>>(new Set());
  const [accountListedIds, setAccountListedIds] = useState<Set<string>>(new Set());
  const [gated, setGated] = useState(false); // 未購読で課金壁に弾かれた＝results_viewを計上しない（水増し防止）
  const [masked, setMasked] = useState(false); // 未購読(free)=マスク版(タイトル/画像/利益率のみ)を表示中

  useEffect(() => {
    setLoading(true);
    fetchProducts()
      .then(({ products, lastUpdated, masked }) => {
        // 未購読はリダイレクトせずマスク版(ティーザー)を表示。results_viewは計上しない(水増し防止)。
        setMasked(!!masked); setGated(!!masked);
        setAllProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  // eBayで売れた商品を取得（連携済みのみ。未連携なら空セット）
  useEffect(() => {
    fetchSoldIds().then((s) => setSoldIds(s.ids)).catch(() => {});
  }, []);

  // 自分が出品/販売済みの商品ID（アカウント単位）を取得（別端末でも効く。失敗時は内部でキャッシュ）。
  // 取得成功時に端末の listed_ フラグを正本と突合して掃除するので、解決後に listedIds を読み直す
  // ＝停止/削除でサーバーから消えた商品の「出品済み」固着が解ける。
  useEffect(() => {
    fetchListedIds()
      .then((ids) => { setAccountListedIds(ids); setListedIds(readListedIds()); })
      .catch(() => {});
  }, []);

  // 出品済みの非表示は初回マウントと別タブ(storage)で反映＝「検索を開き直すと出品中一覧へ移っている」挙動にする。
  // （同一タブで即座に消すと出品完了モーダルごと unmount され成功画面が消えるため即時反映はしない）
  useEffect(() => {
    const refreshListed = () => setListedIds(readListedIds());
    refreshListed();
    setSortOrder(readSort());     // 前回の並び替えを復元（ページ移動で初期化されないように）
    try { localStorage.setItem("ob_viewed", "1"); } catch { /* noop */ }
    window.addEventListener("storage", refreshListed); // 別タブ
    return () => window.removeEventListener("storage", refreshListed);
  }, []);
  // 一覧閲覧（ファネル計測）。課金壁で弾かれた未購読(gated)や読込中は計上しない＝水増し防止。
  // 読込完了後、keyword変化でも発火させ過少計上を防ぐ。
  useEffect(() => {
    if (loading || gated) return;
    logEvent("results_view");
  }, [keyword, loading, gated]);

  const filtered = useMemo(() => {
    const q = keyword.toLowerCase().trim();
    if (!q) return allProducts;
    return allProducts.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.coreKeyword ?? "").toLowerCase().includes(q)
    );
  }, [allProducts, keyword]);

  const sorted = useMemo(() => {
    // 出品済みは「非表示」にせず、出品済みと分かるマーク付きで表示する（末尾に回す）。restored(運営手動復活)はマーク対象外。
    const isListed = (p: ProfitProduct) => !p.restored && (listedIds.has(p.id) || accountListedIds.has(p.id));
    const arr = sortProducts(filtered, sortOrder);
    // 最下部へ沈める順：新着(fresh) → 出品済み(listed) → 売却済み(sold)。並び順は各群で維持。
    const fresh = arr.filter((p) => !soldIds.has(p.id) && !isListed(p));
    const listedArr = arr.filter((p) => !soldIds.has(p.id) && isListed(p));
    const sold = arr.filter((p) => soldIds.has(p.id));
    const ordered = [...fresh, ...listedArr, ...sold];
    // 運営が手動復活した商品(restored)だけ先頭に固定。売却済みは除外。
    return pinRestoredFirst(ordered, soldIds);
  }, [filtered, sortOrder, soldIds, listedIds, accountListedIds]);

  // ページネーション（30件/ページ）。並び替え・フィルタ・キーワード変更で1ページ目へ
  const [page, setPage] = useState(1);
  // 並び替え/SOLD除外/検索を変えたら先頭へ戻す（2ページ目での切替が予告なく跳ぶのを防ぐ）
  useEffect(() => { setPage(1); window.scrollTo({ top: 0, behavior: "smooth" }); }, [sortOrder, keyword]);
  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, pageCount)); // 非同期でリストが縮んでも空ページを出さない
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const displayLabel = keyword || "すべて";
  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = sorted.filter(p => p.realProfitRate >= 30).length;

  // 0件/空状態の回復導線で再掲する人気ジャンル（SearchForm と同一）。タップで別語検索へ。
  const GENRES = ["ポケモンカード", "レゴ", "ガンプラ", "フィギュア", "腕時計"];

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* ヘッダー＋件数バーを1つのsticky枠に入れる。検索語の有無でヘッダー高さが変わっても、
          件数/ソートバーが常にヘッダー直下に貼り付く（--header-h=88px のマジックナンバー依存を解消） */}
      <div className="sticky top-0 z-20">
      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 pt-2 pb-2 flex items-center gap-2">
          <Link href="/search"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0 text-lg font-bold hover:bg-white/30 transition-colors">
            ‹
          </Link>
          <div className="flex-1">
            <SearchForm defaultKeyword={keyword} />
          </div>
        </div>
        {keyword && (
          <div className="px-3 pb-1.5">
            <span className="text-white/80 text-xs">「{keyword}」の検索結果</span>
          </div>
        )}
      </header>

      {/* 件数・ソート/SOLD除外バー（上のsticky枠内なのでヘッダー直下に追従。個別のtopオフセットは不要） */}
      <div className="bg-white border-b border-[#A98B5C]/25 px-4 py-2.5 flex items-start justify-between gap-3 shadow-sm">
        <div className="min-w-0">
          {loading ? (
            <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <p className="text-xs text-gray-500">
              <span className="font-black text-[#2D323B] text-base">{sorted.length}</span>
              <span className="ml-0.5">件</span>
              {hotCount > 0 && (
                <span className="ml-2 text-[11px] text-[#5A6472] font-bold inline-flex items-center gap-1"><Flame size={12} />{hotCount}件が利益30%超</span>
              )}
            </p>
          )}
          {updatedLabel && <p className="text-[10px] text-gray-400 mt-0.5">{updatedLabel}</p>}
        </div>

        <ListControls
          sortOrder={sortOrder}
          onSortChange={(v) => { setSortOrder(v); writeSort(v); }}
        />
      </div>
      </div>

      <main className="max-w-2xl mx-auto">
        {/* 未購読(free)=無料プレビュー帯。利益額/仕入れ先/出品はプラン。リダイレクトせず価値を見せてから課金導線。 */}
        {masked && !loading && (
          <div className="bg-gradient-to-r from-[#2D323B] to-[#1A1D23] text-white px-4 py-3">
            <p className="text-[13px] font-black">無料プレビュー中</p>
            <p className="text-[11px] text-white/80 leading-relaxed mt-0.5">
              商品と<b>利益率</b>は見られます。<b>利益額・仕入れ先・eBay相場・出品</b>はプランで全部解放（ライトは30日無料）。
            </p>
            <a href="/pricing?from=catalog" className="mt-2 inline-flex items-center justify-center h-9 px-4 rounded-xl bg-white text-[#2D323B] text-[12px] font-black active:opacity-90">
              30日無料ではじめる →
            </a>
          </div>
        )}
        {loading ? (
          <div className="flex flex-col gap-3 p-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#A98B5C]/25 p-4 animate-pulse shadow-sm">
                <div className="flex gap-3">
                  <div className="w-[88px] h-[88px] bg-gray-100 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                    <div className="h-3 bg-gray-100 rounded-full w-1/2" />
                    <div className="h-5 bg-gray-100 rounded-full w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 bg-white m-3 rounded-2xl shadow-sm border border-[#A98B5C]/25">
            {allProducts.length === 0
              ? <PackageSearch size={44} className="mx-auto mb-4 text-gray-300" />
              : <Search size={44} className="mx-auto mb-4 text-gray-300" />}
            <p className="text-gray-600 text-sm font-semibold mb-1">
              {allProducts.length === 0 ? "いま掲載できる商品がありません" : `「${displayLabel}」の商品が見つかりませんでした`}
            </p>
            {allProducts.length === 0
              ? <p className="text-gray-400 text-xs">時間をおいて再度お試しを。</p>
              : <p className="text-gray-400 text-xs leading-relaxed px-4">楽天全体ではなく<b className="text-gray-500">厳選した利益商品リスト</b>内の検索です。別の言葉か、下のボタンで全件から探してみて。</p>
            }

            {/* 検索0件のときだけ、別語検索を促す人気ジャンルのチップを再掲（タップで検索しなおし） */}
            {allProducts.length > 0 && (
              <div className="mt-4 px-4">
                <p className="text-[11px] text-gray-400 mb-2">人気ジャンルで探す</p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {GENRES.map((g) => (
                    <Link
                      key={g}
                      href={`/results?q=${encodeURIComponent(g)}`}
                      className="text-xs font-bold text-[#2D323B] bg-white border border-[#A98B5C]/40 rounded-full px-3 py-1.5 active:bg-[#2D323B]/5"
                    >
                      {g}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
              {/* 掲載0件は再読み込みで回復（search/page.tsx と同じ導線で一貫させる） */}
              {allProducts.length === 0 && (
                <button
                  onClick={() => window.location.reload()}
                  className="text-sm font-bold text-[#2D323B] border border-[#2D323B] px-5 py-2 rounded-full active:bg-[#2D323B]/5"
                >
                  再読み込み
                </button>
              )}
              {allProducts.length > 0 && (
                <Link href="/results"
                  className="inline-block text-sm font-bold text-white bg-[#2D323B] px-5 py-2 rounded-full active:bg-[#1A1D23]">
                  すべての利益商品を見る
                </Link>
              )}
              <Link href="/search" className="inline-block text-sm font-bold text-gray-500 px-5 py-2">
                ← ホームに戻る
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 p-3">
              {pageItems.map((product) => (
                <ProductCard key={product.id} product={product} ebaySold={soldIds.has(product.id)} listed={!product.restored && (listedIds.has(product.id) || accountListedIds.has(product.id))} />
              ))}
            </div>
            <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
          </>
        )}

        {!loading && sorted.length > 0 && (
          <p className="px-4 py-5 text-[10px] text-gray-400 leading-relaxed text-center">
            ※ eBay最安値（現在の出品ベース）で計算。実際の利益は状態・競合・送料で変動します。
          </p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

export default function ResultsPage() {
  return <Suspense><ResultsContent /></Suspense>;
}
