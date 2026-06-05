"use client";
import { Product } from "../types";
import { formatJpy, getProfitBadgeStyle, cn, toRakutenAffiliateUrl, extractCoreKeyword } from "../lib/utils";
import { Globe, ShoppingBag, Heart, Share2 } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";

const MERCARI_SHIPPING = 500;  // メルカリ送料概算
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 40;
const EBAY_SHIPPING = 1500;    // eBay国際送料概算
const MIN_PROFIT = 500;        // 最低利益ライン

interface RealPrice {
  avgPrice: number;
  count: number;
  confidence?: number;
}

interface PlatformResult {
  avgPrice: number;
  profit: number;
  profitRate: number;
  count: number;
  soldUrl: string;
}

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

const LISTING_LIMIT = 30;

export default function ProductCard({
  product,
  onUnprofitable,
}: {
  product: Product;
  onUnprofitable?: () => void;
}) {
  const { source } = product;
  const sourceUrl = source.site === "rakuten" ? toRakutenAffiliateUrl(source.url) : source.url;
  const coreKeyword = product.coreKeyword || extractCoreKeyword(product.title);

  const [listingCount, setListingCount] = useState(0);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);

  // 実績価格ステート
  const [mercariResult, setMercariResult] = useState<PlatformResult | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rakutenTitle: product.title,
        rakutenImageUrl: product.imageUrl,
        rakutenPrice: source.price,
      }),
    })
      .then((r) => r.json())
      .then((d: RealPrice & { matched: boolean }) => {
        if (d.matched && d.avgPrice) {
          const avg = d.avgPrice;
          const fee = Math.round(avg * 0.1);
          const profit = avg - source.price - fee - MERCARI_SHIPPING;
          const profitRate = Math.round((profit / source.price) * 100);
          setMercariResult({
            avgPrice: avg,
            profit,
            profitRate,
            count: d.count,
            soldUrl: product.mercariSoldUrl ?? "",
          });
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [product.id]);

  useEffect(() => {
    fetch(`/api/listing-count/${product.id}`)
      .then((r) => r.json())
      .then((d) => setListingCount(d.count ?? 0))
      .catch(() => {});
  }, [product.id]);

  // 利益なし → 非表示コールバック
  useEffect(() => {
    if (!checking && !mercariResult && onUnprofitable) {
      onUnprofitable();
    }
  }, [checking, mercariResult]);

  // 確認中は何も表示しない（ローディング）
  if (checking) {
    return (
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 animate-pulse">
        <div className="flex gap-3">
          <div className="w-16 h-16 bg-gray-100 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 bg-gray-100 rounded-full w-1/3" />
            <div className="h-3 bg-gray-100 rounded-full w-3/4" />
            <div className="h-3 bg-gray-100 rounded-full w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  // 利益500円未満 → 非表示
  if (!mercariResult || mercariResult.profit < MIN_PROFIT) return null;

  const limitReached = listingCount >= LISTING_LIMIT;
  const bestProfitRate = mercariResult.profitRate;

  const shareOnX = () => {
    const text = `【輸出で副業】${product.title}\n仕入れ: ${formatJpy(source.price)} → 利益率${bestProfitRate}%！\n#輸出副業 #メルカリ`;
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
              getProfitBadgeStyle(bestProfitRate)
            )}>
              +{bestProfitRate}%
            </span>
          </div>
          <h3 className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">{product.title}</h3>
        </div>
      </div>

      {/* メルカリ利益 */}
      <div className="px-4 pt-2 pb-1">
        <div className="py-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 w-16 shrink-0">
              <ShoppingBag size={12} className="text-rose-400 shrink-0" />
              <span className="text-xs font-medium text-gray-500">メルカリ</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-xs text-gray-600 font-medium">{formatJpy(mercariResult.avgPrice)}</span>
                <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">
                  実績{mercariResult.count}件
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {mercariResult.soldUrl && (
                <a href={mercariResult.soldUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-600"
                  onClick={(e) => e.stopPropagation()}>
                  確認↗
                </a>
              )}
              <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border", getProfitBadgeStyle(mercariResult.profitRate))}>
                +{mercariResult.profitRate}%
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1 pl-0.5">
            利益 <span className="text-indigo-500 font-semibold">{formatJpy(mercariResult.profit)}</span>／個
            <span className="text-gray-300 ml-1">（手数料10% + 送料{formatJpy(MERCARI_SHIPPING)}）</span>
          </p>
        </div>

        {(source.pointAmount ?? 0) > 0 && (
          <div className="flex items-center gap-1 pt-2 border-t border-gray-100">
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
