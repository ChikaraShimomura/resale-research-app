"use client";
import { formatJpy, getProfitBadgeStyle, cn, toRakutenAffiliateUrl } from "../lib/utils";
import { ShoppingBag, Heart, Share2 } from "lucide-react";
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

export default function ProductCard({ product }: { product: ProfitProduct }) {
  const { source } = product;
  const sourceUrl = source.site === "rakuten" ? toRakutenAffiliateUrl(source.url) : source.url;
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
    const text = `【転売リサーチ】${product.title}\n仕入れ: ${formatJpy(source.price)} → メルカリ利益率${product.realProfitRate}%！\n#転売 #メルカリ`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.yushutsu-fukugyo.com")}`, "_blank");
  };

  return (
    <div className={cn(
      "relative bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 transition-all active:scale-[0.99]",
      (product.soldOut || limitReached) && "opacity-50"
    )}>
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

      {/* ヘッダー */}
      <div className="flex gap-3 p-4 pb-0">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.title}
            className="w-16 h-16 rounded-xl object-cover shrink-0 bg-gray-100" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gray-100 shrink-0 flex items-center justify-center text-2xl">📦</div>
        )}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 border border-red-100">
              楽天 {formatJpy(source.price)}
            </span>
            {product.isNew && (
              <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-indigo-600 text-white">NEW</span>
            )}
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-bold border ml-auto",
              getProfitBadgeStyle(product.realProfitRate)
            )}>
              +{product.realProfitRate}%
            </span>
          </div>
          <h3 className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">{product.title}</h3>
        </div>
      </div>

      {/* メルカリ利益 */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 w-16 shrink-0">
            <ShoppingBag size={12} className="text-rose-400 shrink-0" />
            <span className="text-xs font-medium text-gray-500">ヤフオク</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs text-gray-600 font-medium">{formatJpy(product.realAvgPrice)}</span>
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">
                実績{product.realCount}件
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {product.mercariSoldUrl && (
              <a href={product.mercariSoldUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-600"
                onClick={(e) => e.stopPropagation()}>
                ヤフオク↗
              </a>
            )}
            <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border", getProfitBadgeStyle(product.realProfitRate))}>
              +{product.realProfitRate}%
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1 pl-0.5">
          利益 <span className="text-indigo-500 font-semibold">{formatJpy(product.realProfit)}</span>／個
          <span className="text-gray-300 ml-1">（手数料10% + 送料¥500）</span>
        </p>

        {(source.pointAmount ?? 0) > 0 && (
          <div className="flex items-center gap-1 pt-2 border-t border-gray-100 mt-2">
            <span className="text-xs text-orange-500 font-medium">🎁 +{(source.pointAmount ?? 0).toLocaleString()}pt 還元</span>
          </div>
        )}
      </div>

      {/* アクションボタン */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        <div className="flex gap-2">
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 text-center py-2.5 bg-indigo-600 active:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors">
            楽天で仕入れる ↗
          </a>
          <button onClick={toggleFav}
            className={cn("w-10 h-10 flex items-center justify-center rounded-xl border transition-colors",
              isFav ? "bg-rose-50 border-rose-200 text-rose-500" : "bg-gray-50 border-gray-200 text-gray-400")}>
            <Heart size={16} fill={isFav ? "currentColor" : "none"} />
          </button>
          <button onClick={shareOnX}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400">
            <Share2 size={16} />
          </button>
        </div>
        {!limitReached && (
          <ListingHelper product={product} onCountChange={setListingCount} />
        )}
      </div>
    </div>
  );
}
