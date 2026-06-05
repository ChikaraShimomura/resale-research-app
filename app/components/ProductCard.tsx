"use client";
import { Product, ProfitInfo } from "../types";
import { formatJpy, getProfitBadgeStyle, cn, toRakutenAffiliateUrl, extractCoreKeyword, toEbaySoldUrl, toMercariSoldUrl } from "../lib/utils";
import { Globe, ShoppingBag, Heart, Share2 } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";

interface MercariReal {
  avgPrice: number;
  count: number;
  confidence?: number;
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

function ProfitRow({ p, mercariReal, buyPrice, coreKeyword }: {
  p: ProfitInfo;
  mercariReal?: MercariReal | null;
  buyPrice?: number;
  coreKeyword?: string;
}) {
  const isEbay = p.platform === "ebay";
  const icon = isEbay
    ? <Globe size={12} className="text-blue-500 shrink-0" />
    : <ShoppingBag size={12} className="text-rose-400 shrink-0" />;

  let displayAvgPrice = p.avgPrice;
  let displayProfit = p.profit;
  let displayProfitRate = p.profitRate;
  let isRealData = false;

  if (!isEbay && mercariReal && buyPrice) {
    const realAvg = mercariReal.avgPrice;
    displayAvgPrice = realAvg;
    displayProfit = realAvg - buyPrice - Math.round(realAvg * 0.1) - 500;
    displayProfitRate = Math.round((displayProfit / buyPrice) * 100);
    isRealData = true;
  }

  const monthlyMarket = Math.round(p.soldCount / 3);
  const myMonthly = Math.max(1, Math.round(monthlyMarket * 0.1));
  const monthlyProfit = myMonthly * displayProfit;
  const soldUrl = isEbay
    ? (coreKeyword ? toEbaySoldUrl(coreKeyword) : null)
    : (coreKeyword ? toMercariSoldUrl(coreKeyword) : null);

  return (
    <div className="py-2 border-t border-gray-100 first:border-0">
      <div className="flex items-center gap-2">
        {/* プラットフォーム名 */}
        <div className="flex items-center gap-1 w-16 shrink-0">
          {icon}
          <span className="text-xs font-medium text-gray-500">{p.platformName}</span>
        </div>

        {/* 相場価格 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-gray-600 font-medium">{formatJpy(displayAvgPrice)}</span>
            {isRealData ? (
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">
                実績{mercariReal!.count}件{mercariReal!.confidence ? ` ${mercariReal!.confidence}%一致` : ""}
              </span>
            ) : (
              <span className="text-xs text-gray-400">（推定）</span>
            )}
          </div>
        </div>

        {/* 利益バッジ */}
        <div className="flex items-center gap-1.5 shrink-0">
          {soldUrl && (
            <a href={soldUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-600"
              onClick={(e) => e.stopPropagation()}>
              確認↗
            </a>
          )}
          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border", getProfitBadgeStyle(displayProfitRate))}>
            {displayProfit >= 0 ? "+" : ""}{displayProfitRate}%
          </span>
        </div>
      </div>

      {/* 月利計算 */}
      {displayProfit > 0 && (
        <p className="text-xs text-gray-400 mt-1 pl-0.5">
          月{myMonthly}個 →
          <span className="text-indigo-500 font-semibold"> {formatJpy(monthlyProfit)}/月</span>
          <span className="text-gray-300 ml-1">（利益 {formatJpy(displayProfit)}/個）</span>
        </p>
      )}
    </div>
  );
}

export default function ProductCard({ product }: { product: Product }) {
  const { source } = product;
  const sourceUrl = source.site === "rakuten" ? toRakutenAffiliateUrl(source.url) : source.url;
  const coreKeyword = extractCoreKeyword(product.title);

  const [listingCount, setListingCount] = useState(0);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);
  const [mercariReal, setMercariReal] = useState<MercariReal | null>(null);

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
      .then((d) => { if (d.matched && d.avgPrice) setMercariReal(d); })
      .catch(() => {});
  }, [product.id]);

  useEffect(() => {
    fetch(`/api/listing-count/${product.id}`)
      .then((r) => r.json())
      .then((d) => setListingCount(d.count ?? 0))
      .catch(() => {});
  }, [product.id]);

  const limitReached = listingCount >= LISTING_LIMIT;

  const bestProfitRate = Math.max(...product.profits.map((p) => p.profitRate));

  const shareOnX = () => {
    const text = `【輸出で副業】${product.title}\n仕入れ: ${formatJpy(source.price)} → 最大利益率${bestProfitRate}%！\n#輸出副業 #eBay`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.yushutsu-fukugyo.com")}`, "_blank");
  };

  return (
    <div className={cn(
      "relative bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 transition-all active:scale-[0.99]",
      (product.soldOut || limitReached) && "opacity-50"
    )}>
      {/* SOLD オーバーレイ */}
      {product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="rotate-[-20deg] border-4 border-red-500 text-red-500 text-2xl font-black px-4 py-1 rounded-lg tracking-widest opacity-80">SOLD</span>
        </div>
      )}

      {/* 利用上限オーバーレイ */}
      {limitReached && !product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl px-4 py-3 text-center shadow-lg max-w-xs border border-gray-100">
            <p className="text-sm font-bold text-gray-700">出品上限に達しました</p>
            <p className="text-xs text-gray-400 mt-1">市場の乱立防止のため紹介終了</p>
          </div>
        </div>
      )}

      {/* ヘッダー：画像 + タイトル */}
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
              最大{bestProfitRate}%
            </span>
          </div>
          <h3 className="text-sm font-medium text-gray-800 leading-snug line-clamp-2">{product.title}</h3>
        </div>
      </div>

      {/* 利益比較 */}
      <div className="px-4 pt-2 pb-1">
        {product.profits.map((p) => (
          <ProfitRow key={p.platform} p={p} mercariReal={mercariReal} buyPrice={source.price} coreKeyword={coreKeyword} />
        ))}
        {(source.pointAmount ?? 0) > 0 && (
          <div className="flex items-center gap-1 pt-2 border-t border-gray-100 mt-1">
            <span className="text-xs text-orange-500 font-medium">🎁 +{(source.pointAmount ?? 0).toLocaleString()}pt 還元</span>
          </div>
        )}
      </div>

      {/* アクションボタン */}
      <div className="px-4 pb-4 pt-2 space-y-2">
        {/* 仕入れ + お気に入り + シェア */}
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

        {/* 出品ボタン */}
        {!limitReached && (
          <ListingHelper product={product} onCountChange={setListingCount} />
        )}
      </div>
    </div>
  );
}
