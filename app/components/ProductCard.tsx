"use client";
import { formatJpy, cn, toRakutenAffiliateUrl } from "../lib/utils";
import { Heart, Share2, TrendingUp, ChevronRight } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";
import { ProfitProduct } from "../lib/profitFilter";

const LISTING_LIMIT = 30;

function useFavorite(productId: string) {
  const key = `fav_${productId}`;
  const [isFav, setIsFav] = useState(false);
  useEffect(() => { setIsFav(localStorage.getItem(key) === "1"); }, [key]);
  const toggle = () => {
    const next = !isFav;
    next ? localStorage.setItem(key, "1") : localStorage.removeItem(key);
    setIsFav(next);
  };
  return { isFav, toggle };
}

function ProfitBadge({ rate }: { rate: number }) {
  if (rate >= 50) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-black px-2.5 py-1 rounded-full bg-red-500 text-white shadow-sm shadow-red-200">
      🔥 +{rate}%
    </span>
  );
  if (rate >= 30) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500 text-white shadow-sm shadow-emerald-200">
      ↑ +{rate}%
    </span>
  );
  if (rate >= 10) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-400 text-white shadow-sm shadow-amber-100">
      +{rate}%
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
      +{rate}%
    </span>
  );
}

export default function ProductCard({ product }: { product: ProfitProduct }) {
  const { source } = product;
  const sourceUrl = toRakutenAffiliateUrl(source.url);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);
  const [listingCount, setListingCount] = useState(0);

  useEffect(() => {
    fetch(`/api/listing-count/${product.id}`)
      .then((r) => r.json())
      .then((d) => setListingCount(d.count ?? 0))
      .catch(() => {});
  }, [product.id]);

  const limitReached = listingCount >= LISTING_LIMIT;

  const shareOnX = () => {
    const text = `【転売リサーチ】${product.title}\n仕入れ: ${formatJpy(source.price)} → eBay利益率${product.realProfitRate}%！\n#転売 #eBay`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.yushutsu-fukugyo.com")}`, "_blank");
  };

  const isHot = product.realProfitRate >= 50;

  return (
    <div className={cn(
      "relative bg-white rounded-2xl overflow-hidden transition-all",
      "shadow-[0_2px_12px_rgba(0,0,0,0.06)] active:shadow-[0_1px_4px_rgba(0,0,0,0.08)] active:scale-[0.992]",
      (product.soldOut || limitReached) && "opacity-50"
    )}>

      {/* ホット商品ライン */}
      {isHot && !product.soldOut && (
        <div className="h-1 bg-gradient-to-r from-orange-400 via-red-500 to-pink-500" />
      )}

      {product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="rotate-[-20deg] border-4 border-red-500 text-red-500 text-2xl font-black px-4 py-1 rounded-lg tracking-widest opacity-80">SOLD</span>
        </div>
      )}
      {limitReached && !product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl px-4 py-3 text-center shadow-lg max-w-xs border border-gray-100">
            <p className="text-sm font-bold text-gray-700">出品上限に達しました</p>
            <p className="text-xs text-gray-400 mt-1">市場の乱立防止のため紹介終了</p>
          </div>
        </div>
      )}

      <div className="p-4">
        {/* 上段：画像 + タイトル + バッジ */}
        <div className="flex gap-3 mb-3">
          {/* サムネイル（メルカリ風：大きめ） */}
          <div className="shrink-0">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-20 h-20 rounded-xl object-cover bg-gray-100"
              />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 flex items-center justify-center text-3xl">
                📦
              </div>
            )}
          </div>

          {/* 情報 */}
          <div className="flex-1 min-w-0">
            {/* タグ行 */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              {product.isNew && (
                <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-indigo-600 text-white leading-none">NEW</span>
              )}
              {isHot && (
                <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-orange-50 text-orange-500 border border-orange-200 leading-none">急騰中</span>
              )}
              <span className="ml-auto">
                <ProfitBadge rate={product.realProfitRate} />
              </span>
            </div>

            {/* 商品名 */}
            <h3 className="text-[13px] font-medium text-gray-800 leading-snug line-clamp-2 mb-2">
              {product.title}
            </h3>

            {/* ポイント還元 */}
            {(source.pointAmount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-orange-500 font-semibold">
                🎁 {(source.pointAmount ?? 0).toLocaleString()}pt 還元
              </span>
            )}
          </div>
        </div>

        {/* 価格フロー（Yahoo!フリマ風：矢印で仕入れ→売値を表現） */}
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-3">
          <div className="flex items-center gap-2">
            {/* 仕入れ価格 */}
            <div className="text-center min-w-0">
              <p className="text-[10px] text-gray-400 font-medium mb-0.5">楽天仕入れ</p>
              <p className="text-sm font-bold text-gray-700">{formatJpy(source.price)}</p>
            </div>

            {/* 矢印 */}
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <ChevronRight size={16} className="text-indigo-400" />
            </div>

            {/* eBay売値 */}
            <div className="text-center min-w-0">
              <p className="text-[10px] text-blue-500 font-medium mb-0.5">eBay平均落札</p>
              <p className="text-sm font-bold text-blue-600">{formatJpy(product.realAvgPrice)}</p>
            </div>

            {/* 区切り */}
            <div className="w-px h-8 bg-gray-200 mx-1 shrink-0" />

            {/* 利益額（PayPay風：大きく強調） */}
            <div className="flex-1 text-right">
              <p className="text-[10px] text-emerald-600 font-medium mb-0.5">利益（手数料後）</p>
              <p className="text-base font-black text-emerald-600">
                {formatJpy(product.realProfit)}
              </p>
            </div>
          </div>

          {/* 実績件数 */}
          {product.realCount > 0 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-1">
                <TrendingUp size={11} className="text-blue-400" />
                <span className="text-[11px] text-gray-400">eBay落札実績</span>
                <span className="text-[11px] font-bold text-blue-500">{product.realCount}件</span>
              </div>
              {product.ebaySoldUrl && (
                <a
                  href={product.ebaySoldUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] text-indigo-400 font-medium hover:text-indigo-600"
                >
                  実績を見る ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* アクションボタン群 */}
        <div className="space-y-2">
          {/* 仕入れ＋ハートボタン */}
          <div className="flex gap-2">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center py-2.5 bg-indigo-600 active:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors"
            >
              楽天で仕入れる ↗
            </a>
            <button
              onClick={toggleFav}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-xl border-2 transition-colors",
                isFav
                  ? "bg-rose-50 border-rose-300 text-rose-500"
                  : "bg-gray-50 border-gray-200 text-gray-300"
              )}
            >
              <Heart size={16} fill={isFav ? "currentColor" : "none"} />
            </button>
            <button
              onClick={shareOnX}
              className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100"
            >
              <Share2 size={16} />
            </button>
          </div>

          {/* eBay出品ボタン */}
          {!limitReached && (
            <ListingHelper product={product} onCountChange={setListingCount} />
          )}
        </div>
      </div>
    </div>
  );
}
