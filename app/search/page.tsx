"use client";
import Link from "next/link";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import BottomNav from "../components/BottomNav";
import AuthButton from "../components/AuthButton";
import OnboardingChecklist from "../components/OnboardingChecklist";
import { fetchProducts } from "../lib/products";
import { useEffect, useState } from "react";
import { ProfitProduct } from "../lib/profitFilter";
import { SortOrder, sortProducts } from "../components/SortSelect";
import ListControls from "../components/ListControls";
import { readListedIds, pinRestoredFirst } from "../lib/unlocked";
import { fetchListedIds } from "../lib/ebayListed";
import { readSort, writeSort } from "../lib/prefs";
import Pagination, { PAGE_SIZE } from "../components/Pagination";
import { Flame, PackageSearch } from "lucide-react";

export default function SearchPage() {
  const [products, setProducts] = useState<ProfitProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(true); // 初期はtrueでチラつき防止
  const [sortOrder, setSortOrder] = useState<SortOrder>("recommended"); // 既定=総合おすすめ順
  // 自分がeBayに出品済みの商品ID。本人の一覧からは隠して「出品中一覧へ移った」状態にする。
  // listedIds=この端末(localStorage)／accountListedIds=アカウント(サーバー・別端末でも効く)。両方で隠す。
  const [listedIds, setListedIds] = useState<Set<string>>(new Set());
  const [accountListedIds, setAccountListedIds] = useState<Set<string>>(new Set());
  const [masked, setMasked] = useState(false); // 未購読(free)=マスク版(タイトル/画像/利益率のみ)を表示中

  useEffect(() => {
    setBannerDismissed(localStorage.getItem("spu_banner_dismissed") === "1");
    setSortOrder(readSort());        // 前回の並び替えを復元（ページ移動で初期化されないように）
    setListedIds(readListedIds());
    fetchListedIds().then(setAccountListedIds).catch(() => {}); // アカウントの出品済み（別端末でも効く。失敗時は内部でキャッシュ）
    try { localStorage.setItem("ob_viewed", "1"); } catch { /* noop */ }
    fetchProducts()
      .then(({ products, lastUpdated, masked }) => {
        setMasked(!!masked); // 未購読はリダイレクトせずマスク版(ティーザー)を表示＝価値を見せてから課金導線へ
        setProducts(products);
        setLastUpdated(lastUpdated);
      })
      .finally(() => setLoading(false));
  }, []);

  // 出品済みの非表示は別タブ(storage)と次回マウント時に反映＝「検索を開き直すと出品中一覧へ移っている」挙動にする。
  // （同一タブで即座に消すと、出品完了モーダルごと unmount され成功画面が一瞬で消えるため即時反映はしない）
  useEffect(() => {
    const refreshListed = () => setListedIds(readListedIds());
    window.addEventListener("storage", refreshListed);
    return () => window.removeEventListener("storage", refreshListed);
  }, []);

  const dismissBanner = () => {
    localStorage.setItem("spu_banner_dismissed", "1");
    setBannerDismissed(true);
  };

  const updatedLabel = lastUpdated
    ? `${new Date(lastUpdated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新`
    : null;

  // 出品済みは「非表示」にせず、出品済みと分かるマーク付きで表示する（末尾に回して新しい利益商品を上に残す）。
  // 端末(listedIds)＋アカウント(accountListedIds)の両方で判定＝別端末で出した分も対象。restored(運営手動復活)はマーク対象外＝常に通常表示。
  const isListed = (p: ProfitProduct) => !p.restored && (listedIds.has(p.id) || accountListedIds.has(p.id));
  const visible = products;
  const hotCount = visible.filter(p => p.realProfitRate >= 30).length;
  // restoredを先頭固定→sortOrderで並べ、出品済みだけ末尾へ安定移動。
  const ordered = pinRestoredFirst(sortProducts(visible, sortOrder));
  const sortedProducts = [...ordered.filter(p => !isListed(p)), ...ordered.filter(p => isListed(p))];
  const visibleCount = visible.length;

  // ページネーション（30件/ページ）。並び替え・フィルタ変更時は1ページ目に戻す
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); window.scrollTo({ top: 0, behavior: "smooth" }); }, [sortOrder]);
  const pageCount = Math.ceil(sortedProducts.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, pageCount)); // 非同期でリストが縮んでも空ページを出さない
  const pageItems = sortedProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="min-h-dvh bg-[#F5F7FA] pb-nav">

      {/* 楽天風ヘッダー（スクロールしても固定） */}
      <header className="bg-gradient-to-r from-[#2D323B] to-[#2D323B] shadow-sm sticky top-0 z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        {/* ロゴ行 */}
        <div className="px-3 pt-2 pb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 楽天風ロゴ */}
            <div className="flex items-center gap-1">
              <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                <span className="text-[#2D323B] font-black text-sm leading-none">R</span>
              </div>
              <span className="text-white font-black text-base tracking-tight">輸出ラボ</span>
            </div>
          </div>
          {/* ログイン時はメールで横幅を食うため、ヘッダーは要点だけに絞る。
              ガイドはホーム/バナーの「使い方」で到達できる。 */}
          <div className="flex items-center gap-1.5 min-w-0">
            <AuthButton />
            <Link href="/settings" className="w-10 h-10 -mr-1 flex items-center justify-center text-white/80 hover:text-white active:scale-95 shrink-0" aria-label="設定">
              <Gear16 />
            </Link>
          </div>
        </div>
        {/* 検索バー */}
        <div className="px-3 pb-2.5">
          <SearchForm />
        </div>
      </header>

      <main className="max-w-2xl mx-auto">

        {/* 未購読(free)=無料プレビュー帯。利益額/仕入れ先/出品はプラン。価値を見せてから課金導線(リダイレクトしない)。 */}
        {masked && (
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

        {/* はじめてガイド（連携→出品→売れる の進捗。全完了/×で自動非表示。初回導線の背骨） */}
        <OnboardingChecklist />

        {/* ポイントキャンペーンバナー（白基調＋クリムゾン差し色。ヘッダーの赤と衝突しないクリーンな配色） */}
        {!bannerDismissed && (
          <div className="bg-white border-b border-[#A98B5C]/25 px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-[#2D323B] rounded-full flex items-center justify-center shrink-0">
              <span className="text-white font-black text-base leading-none">R</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-gray-900 font-black text-sm">楽天×eBayで稼ぐ</p>
              <p className="text-gray-500 text-xs leading-snug">仕入れで最大20%ポイント還元 ＋ 海外で高値売却</p>
            </div>
            <Link href="/guide" className="text-[11px] font-bold text-[#2D323B] border border-[#2D323B] px-3 py-1.5 rounded-full shrink-0 active:bg-[#2D323B]/5">
              使い方 ›
            </Link>
            <button onClick={dismissBanner} aria-label="バナーを閉じる"
              className="w-9 h-9 -mr-1.5 flex items-center justify-center text-gray-400 hover:text-gray-600 active:scale-90 shrink-0 text-lg leading-none">
              ×
            </button>
          </div>
        )}


        {/* セクションヘッダー（件数 + 右に並び替え/SOLD除外を上下配置） */}
        <div className="bg-white px-4 py-2.5 border-b border-[#A98B5C]/25 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {loading ? (
              <div className="h-4 w-24 bg-gray-100 rounded-full animate-pulse" />
            ) : (
              <p className="text-xs text-gray-500">
                <span className="font-black text-[#2D323B] text-base">{visibleCount}</span>
                <span className="ml-0.5">件の利益商品</span>
                {hotCount > 0 && (
                  <span className="ml-2 text-[13px] text-[#5A6472] font-bold inline-flex items-center gap-1"><Flame size={13} />{hotCount}件が利益30%超</span>
                )}
              </p>
            )}
            {updatedLabel && (
              <p className="text-[11px] text-gray-400 mt-0.5">{updatedLabel}</p>
            )}
          </div>
          <ListControls
            sortOrder={sortOrder}
            onSortChange={(v) => { setSortOrder(v); writeSort(v); }}
          />
        </div>

        <div className="px-0">
          {loading ? (
            <div className="flex flex-col gap-3 p-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-[#A98B5C]/25 p-4 shadow-sm animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-[90px] h-[90px] bg-gray-100 rounded-xl shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 bg-gray-100 rounded-full w-3/4" />
                      <div className="h-3 bg-gray-100 rounded-full w-1/2" />
                      <div className="h-5 bg-gray-100 rounded-full w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 bg-white m-3 rounded-2xl border border-[#A98B5C]/25 shadow-sm">
              <PackageSearch size={44} className="mx-auto mb-4 text-gray-300" />
              <p className="text-gray-600 text-sm font-semibold mb-1">いま掲載できる商品がありません</p>
              <p className="text-gray-400 text-xs mb-5">少し時間をおいて開き直してください。</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="text-sm font-bold text-[#2D323B] border border-[#2D323B] px-5 py-2 rounded-full active:bg-red-50"
                >
                  再読み込み
                </button>
                <Link href="/guide" className="text-sm font-bold text-gray-500 px-5 py-2">
                  使い方を見る
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 p-3">
                {pageItems.map((product) => (
                  <ProductCard key={product.id} product={product} listed={isListed(product)} />
                ))}
              </div>
              <Pagination page={safePage} pageCount={pageCount} onChange={setPage} />
            </>
          )}
        </div>

        {!loading && products.length > 0 && (
          <p className="px-4 py-5 text-[11px] text-gray-400 leading-relaxed text-center">
            ※ eBay最安値から楽天ポイント・eBay手数料(13.25%)・国内送料・米国関税($100超)を差引いた額（国際送料は購入者負担）。実際の利益は状態・競合・為替・重量で変動。
          </p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}

function Gear16() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
