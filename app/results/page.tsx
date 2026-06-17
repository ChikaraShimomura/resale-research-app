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
import { isSold, withSoldDummies } from "../lib/sold";
import { fetchSoldIds } from "../lib/ebaySold";
import { readUnlockedIds, readListedIds, pinUnlockedFirst } from "../lib/unlocked";
import { fetchListedIds } from "../lib/ebayListed";
import { readSort, writeSort, readHideSold, writeHideSold } from "../lib/prefs";
import { logEvent } from "../lib/analytics";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import { Heart, Flame, PackageSearch, Search } from "lucide-react";

function ResultsContent() {
  const params = useSearchParams();
  const keyword = params.get("q") ?? "";

  const [allProducts, setAllProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  // 既定=総合おすすめ順（利幅×需要×手頃さ×ライバルのバランス）。新着順は選択肢に残す。
  const [sortOrder, setSortOrder] = useState<SortOrder>("recommended");
  const [hideSold, setHideSold] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // 自分がeBayで売れた商品ID（端末単位）。最下部化/非表示に使う。
  const [soldIds, setSoldIds] = useState<Set<string>>(new Set());
  // 「楽天で仕入れる」を押した（=eBay自動出品アクティブ）商品ID。先頭固定に使う。
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  // 自分がeBayに出品済みの商品ID。本人の検索結果からは隠して「出品中一覧へ移った」状態にする。
  // listedIds=この端末(localStorage)／accountListedIds=アカウント(サーバー・別端末でも効く)。両方で隠す。
  const [listedIds, setListedIds] = useState<Set<string>>(new Set());
  const [accountListedIds, setAccountListedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetchProducts()
      .then(({ products, lastUpdated }) => {
        setAllProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  // eBayで売れた商品を取得（連携済みのみ。未連携なら空セット）
  useEffect(() => {
    fetchSoldIds().then((s) => setSoldIds(s.ids)).catch(() => {});
  }, []);

  // 自分が出品/販売済みの商品ID（アカウント単位）を取得して検索結果から隠す（別端末でも効く。失敗時は内部でキャッシュ）。
  useEffect(() => {
    fetchListedIds().then(setAccountListedIds).catch(() => {});
  }, []);

  // アクティブ（仕入れ中）商品IDを取得（先頭固定/SOLD除外用）。出品・仕入れの変化でも再取得する。
  // 同一タブ(rkt-changed)では unlocked だけ更新＝出品成功の直後に listed で当該カードを消すと
  // その配下の出品完了モーダルごと unmount され成功画面が消えるため。出品済みの非表示は
  // 初回マウントと別タブ(storage)で反映＝「検索を開き直すと出品中一覧へ移っている」挙動にする。
  useEffect(() => {
    const refreshUnlocked = () => setUnlockedIds(readUnlockedIds());
    const refreshAll = () => { setUnlockedIds(readUnlockedIds()); setListedIds(readListedIds()); };
    refreshAll();
    setSortOrder(readSort());     // 前回の並び替えを復元（ページ移動で初期化されないように）
    setHideSold(readHideSold());  // 前回のSOLD除外も復元
    try { localStorage.setItem("ob_viewed", "1"); } catch { /* noop */ }
    window.addEventListener("rkt-changed", refreshUnlocked); // 同一タブの仕入れ/出品
    window.addEventListener("storage", refreshAll); // 別タブ
    return () => {
      window.removeEventListener("rkt-changed", refreshUnlocked);
      window.removeEventListener("storage", refreshAll);
    };
  }, []);
  // 一覧閲覧（ファネル計測）。2回目以降の検索（keyword変化）でも発火させ過少計上を防ぐ。
  useEffect(() => {
    logEvent("results_view");
  }, [keyword]);

  const filtered = useMemo(() => {
    const q = keyword.toLowerCase().trim();
    if (!q) return allProducts;
    return allProducts.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      (p.coreKeyword ?? "").toLowerCase().includes(q)
    );
  }, [allProducts, keyword]);

  const sorted = useMemo(() => {
    // 自分が出品済みの商品は本人の検索結果から除外（出品＝「出品中一覧」へ移す）。SOLD除外の有無に関わらず常に隠す。
    // 端末(listedIds)＋アカウント(accountListedIds)の両方で判定＝別端末で出品したものも隠れる。
    // ただし運営が手動復活した商品(restored)は、出品記録が残っていても常に表示する（復活の目的が表示なので除外しない）。
    const visible = filtered.filter((p) => p.restored || (!listedIds.has(p.id) && !accountListedIds.has(p.id)));
    // 「SOLD除外」でも、自分が仕入れ中（unlocked）の商品は残す（出品導線を消さない。ProductCardのsold判定と一致）
    const base = hideSold ? visible.filter((p) => !isSold(p) || unlockedIds.has(p.id) || p.restored) : withSoldDummies(visible);
    const arr = sortProducts(base, sortOrder);
    // eBayで売れた商品：「SOLDを除外」時は隠し、通常時は最下部へ沈める（並び順は維持）
    let ordered: ProfitProduct[];
    if (soldIds.size === 0) {
      ordered = arr;
    } else if (hideSold) {
      ordered = arr.filter((p) => !soldIds.has(p.id) || p.restored);
    } else {
      const live = arr.filter((p) => !soldIds.has(p.id));
      const sold = arr.filter((p) => soldIds.has(p.id));
      ordered = [...live, ...sold];
    }
    // 「楽天で仕入れる」を押した商品（eBay自動出品アクティブ）を先頭に固定
    return pinUnlockedFirst(ordered, unlockedIds, soldIds);
  }, [filtered, sortOrder, hideSold, soldIds, unlockedIds, listedIds, accountListedIds]);

  // ページネーション（30件/ページ）。並び替え・フィルタ・キーワード変更で1ページ目へ
  const [page, setPage] = useState(1);
  // 並び替え/SOLD除外/検索を変えたら先頭へ戻す（2ページ目での切替が予告なく跳ぶのを防ぐ）
  useEffect(() => { setPage(1); window.scrollTo({ top: 0, behavior: "smooth" }); }, [sortOrder, hideSold, keyword]);
  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, pageCount)); // 非同期でリストが縮んでも空ページを出さない
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const displayLabel = keyword || "すべて";
  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  const hotCount = sorted.filter(p => p.realProfitRate >= 30).length;

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* ヘッダー */}
      <header className="bg-gradient-to-r from-[#BF0000] to-[#BF0000] sticky top-0 z-20 shadow-sm"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-3 pt-2 pb-2 flex items-center gap-2">
          <Link href="/search"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white shrink-0 text-lg font-bold hover:bg-white/30 transition-colors">
            ‹
          </Link>
          <div className="flex-1">
            <SearchForm defaultKeyword={keyword} />
          </div>
          <Link href="/favorites" className="text-white/80 shrink-0 flex items-center" aria-label="お気に入り"><Heart size={20} /></Link>
        </div>
        {keyword && (
          <div className="px-3 pb-1.5">
            <span className="text-white/80 text-xs">「{keyword}」の検索結果</span>
          </div>
        )}
      </header>

      {/* 件数・ソート/SOLD除外バー */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-start justify-between gap-3 sticky top-[calc(var(--header-h,88px))] z-10 shadow-sm">
        <div className="min-w-0">
          {loading ? (
            <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
          ) : (
            <p className="text-xs text-gray-500">
              <span className="font-black text-[#BF0000] text-base">{sorted.length}</span>
              <span className="ml-0.5">件</span>
              {hotCount > 0 && (
                <span className="ml-2 text-[11px] text-[#FF4466] font-bold inline-flex items-center gap-1"><Flame size={12} />{hotCount}件が利益30%超</span>
              )}
            </p>
          )}
          {updatedLabel && <p className="text-[10px] text-gray-400 mt-0.5">{updatedLabel}</p>}
        </div>

        <ListControls
          sortOrder={sortOrder}
          onSortChange={(v) => { setSortOrder(v); writeSort(v); }}
          hideSold={hideSold}
          onHideSoldChange={(v) => { setHideSold(v); writeHideSold(v); }}
        />
      </div>

      <main className="max-w-2xl mx-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse shadow-sm">
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
          <div className="text-center py-16 bg-white m-3 rounded-2xl shadow-sm border border-gray-100">
            {allProducts.length === 0
              ? <PackageSearch size={44} className="mx-auto mb-4 text-gray-300" />
              : <Search size={44} className="mx-auto mb-4 text-gray-300" />}
            <p className="text-gray-600 text-sm font-semibold mb-1">
              {allProducts.length === 0 ? "いま掲載できる商品がありません" : `「${displayLabel}」の商品が見つかりませんでした`}
            </p>
            {allProducts.length === 0
              ? <p className="text-gray-400 text-xs">時間をおいて、もう一度開いてみてください。</p>
              : <p className="text-gray-400 text-xs leading-relaxed px-4">ここは楽天全体の検索ではなく、<b className="text-gray-500">厳選した利益商品リスト</b>からの絞り込みです。別の言葉や、下のボタンで全件から探してみてください。</p>
            }
            <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
              {allProducts.length > 0 && (
                <Link href="/results"
                  className="inline-block text-sm font-bold text-white bg-[#BF0000] px-5 py-2 rounded-full active:bg-[#9E0000]">
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
                <ProductCard key={product.id} product={product} ebaySold={soldIds.has(product.id)} />
              ))}
            </div>
            <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
          </>
        )}

        {!loading && sorted.length > 0 && (
          <p className="px-4 py-5 text-[10px] text-gray-400 leading-relaxed text-center">
            ※ eBay最安値（現在の出品ベース）をもとに計算しています。実際の利益は状態・競合・送料などによって異なります。
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
