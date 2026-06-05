"use client";
import { Product, ProfitInfo } from "../types";
import { formatJpy, getProfitBadgeStyle, cn, toRakutenAffiliateUrl, extractCoreKeyword, toEbaySoldUrl, toMercariSoldUrl } from "../lib/utils";
import { Globe, ShoppingBag, Heart, Share2 } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";

function useFavorite(productId: string) {
  const key = `fav_${productId}`;
  const [isFav, setIsFav] = useState(false);
  useEffect(() => {
    setIsFav(localStorage.getItem(key) === "1");
  }, [key]);
  const toggle = () => {
    const next = !isFav;
    next ? localStorage.setItem(key, "1") : localStorage.removeItem(key);
    setIsFav(next);
  };
  return { isFav, toggle };
}

const LISTING_LIMIT = 30;

const SITE_STYLES: Record<string, string> = {
  rakuten: "bg-red-50 text-red-600 border-red-100",
  surugaya: "bg-purple-50 text-purple-600 border-purple-100",
  bookoff: "bg-green-50 text-green-600 border-green-100",
};

function ProfitRow({ p, mercariReal, buyPrice, coreKeyword }: { p: ProfitInfo; mercariReal?: { avgPrice: number; count: number } | null; buyPrice?: number; coreKeyword?: string }) {
  const icon = p.platform === "ebay"
    ? <Globe size={11} className="text-blue-500 shrink-0" />
    : <ShoppingBag size={11} className="text-red-400 shrink-0" />;

  // メルカリの場合は実データで上書き
  let displayAvgPrice = p.avgPrice;
  let displayProfit = p.profit;
  let displayProfitRate = p.profitRate;
  let isRealData = false;

  if (p.platform === "mercari" && mercariReal && buyPrice) {
    const realAvg = mercariReal.avgPrice;
    const fees = Math.round(realAvg * 0.1);
    const shipping = 500;
    displayAvgPrice = realAvg;
    displayProfit = realAvg - buyPrice - fees - shipping;
    displayProfitRate = Math.round((displayProfit / buyPrice) * 100);
    isRealData = true;
  }

  const monthlyMarket = Math.round(p.soldCount / 3);
  const myMonthly = Math.max(1, Math.round(monthlyMarket * 0.1));
  const monthlyProfit = myMonthly * displayProfit;

  return (
    <div className="py-1 border-t border-gray-100 first:border-0">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 w-16 shrink-0">
          {icon}
          <span className="text-xs text-gray-400">{p.platformName}</span>
        </div>
        <span className="flex-1 text-xs text-gray-400 truncate">
          {formatJpy(displayAvgPrice)}
          {isRealData
            ? <span className="text-green-500 ml-0.5 font-medium">({mercariReal!.count}件実績)</span>
            : <span className="text-gray-300 ml-0.5">({p.soldCount}件)</span>
          }
          {coreKeyword && (
            <a
              href={p.platform === "ebay" ? toEbaySoldUrl(coreKeyword) : toMercariSoldUrl(coreKeyword)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 text-indigo-400 hover:text-indigo-600 underline underline-offset-2 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              実績確認↗
            </a>
          )}
        </span>
        <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded-full border shrink-0", getProfitBadgeStyle(displayProfitRate))}>
          {displayProfit >= 0 ? "+" : ""}{formatJpy(displayProfit)}（{displayProfitRate}%）
        </span>
      </div>
      {displayProfit > 0 && (
        <p className="text-xs text-gray-400 mt-0.5 pl-0.5">
          月{monthlyMarket}件の需要 →
          <span className="text-indigo-500 font-medium"> 月{myMonthly}個売れば {formatJpy(monthlyProfit)}/月</span>
        </p>
      )}
    </div>
  );
}

export default function ProductCard({ product }: { product: Product }) {
  const { source } = product;
  const siteStyle = SITE_STYLES[source.site] ?? "bg-gray-50 text-gray-600 border-gray-200";
  const sourceUrl = source.site === "rakuten" ? toRakutenAffiliateUrl(source.url) : source.url;

  const [listingCount, setListingCount] = useState(0);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);
  const [mercariReal, setMercariReal] = useState<{ avgPrice: number; count: number } | null>(null);

  const coreKeyword = extractCoreKeyword(product.title);

  useEffect(() => {
    fetch(`/api/mercari?q=${encodeURIComponent(coreKeyword)}`)
      .then((r) => r.json())
      .then((d) => { if (d.avgPrice) setMercariReal(d); })
      .catch(() => {});
  }, [product.id, product.title]);

  const shareOnX = () => {
    const bestProfit = product.profits.reduce((a, b) => a.profitRate > b.profitRate ? a : b);
    const text = `【輸出で副業】${product.title}\n仕入れ: ${formatJpy(product.source.price)} → 利益率${bestProfit.profitRate}%！\n#輸出副業 #せどり #eBay`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.yushutsu-fukugyo.com")}`;
    window.open(url, "_blank");
  };

  useEffect(() => {
    fetch(`/api/listing-count/${product.id}`)
      .then((r) => r.json())
      .then((d) => setListingCount(d.count ?? 0))
      .catch(() => {});
  }, [product.id]);

  const limitReached = listingCount >= LISTING_LIMIT;

  return (
    <div className={cn(
      "relative bg-white border border-gray-200 rounded-xl overflow-hidden transition-shadow",
      product.soldOut || limitReached ? "opacity-60" : "hover:shadow-md"
    )}>
      {/* SOLD オーバーレイ */}
      {product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="rotate-[-20deg] border-4 border-red-500 text-red-500 text-2xl font-black px-4 py-1 rounded-lg tracking-widest opacity-80">
            SOLD
          </span>
        </div>
      )}

      {/* 利用上限オーバーレイ */}
      {limitReached && !product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-center shadow-md max-w-xs">
            <p className="text-xs font-bold text-gray-700 leading-relaxed">
              利用上限に達しました。
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              ※各フリマサイトに同じ商品が乱立するのを回避するため、本商品のご紹介は終了します。
            </p>
          </div>
        </div>
      )}

      {/* NEW バッジ */}
      {product.isNew && (
        <span className="absolute top-2 right-2 z-10 bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          NEW
        </span>
      )}

      {/* 商品情報 */}
      <div className="flex gap-2.5 p-3">
        <img src={product.imageUrl} alt={product.title}
          className="w-12 h-12 rounded-lg object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className={cn("text-xs px-1.5 py-0 rounded-full font-medium border leading-5", siteStyle)}>
              {source.siteName} {formatJpy(source.price)}
            </span>
          </div>
          <h3 className="font-medium text-gray-900 text-xs leading-snug line-clamp-2">
            {product.title}
          </h3>
        </div>
      </div>

      {/* 利益比較 */}
      <div className="px-3 pb-2">
        {product.profits.map((p) => (
          <ProfitRow key={p.platform} p={p} mercariReal={mercariReal} buyPrice={source.price} coreKeyword={coreKeyword} />
        ))}
        {source.site === "rakuten" && source.pointAmount && (
          <div className="flex items-center gap-1 pt-1.5 border-t border-gray-100 mt-1">
            <span className="text-xs text-orange-500 font-medium">
              🎁 さらに +{source.pointAmount.toLocaleString()}楽天ポイント が別途もらえます
            </span>
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="px-3 pb-3 space-y-1.5">
        <div className="flex gap-1.5">
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 text-center py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            {source.siteName}で仕入れる ↗
          </a>
          <button onClick={toggleFav}
            className={cn("px-2.5 py-1.5 border text-xs rounded-lg transition-colors", isFav ? "border-pink-300 bg-pink-50 text-pink-500" : "border-gray-200 text-gray-400 hover:bg-gray-50")}>
            <Heart size={13} fill={isFav ? "currentColor" : "none"} />
          </button>
          <button onClick={shareOnX}
            className="px-2.5 py-1.5 border border-gray-200 text-gray-400 text-xs rounded-lg hover:bg-gray-50 transition-colors">
            <Share2 size={13} />
          </button>
          <Link href={`/product/${product.id}`}
            className="px-2.5 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg hover:bg-gray-50 transition-colors">
            詳細
          </Link>
        </div>
        {!limitReached && (
          <ListingHelper product={product} onCountChange={setListingCount} />
        )}
      </div>
    </div>
  );
}
