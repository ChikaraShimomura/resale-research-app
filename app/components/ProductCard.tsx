"use client";
import { formatJpy, cn, toRakutenAffiliateUrl } from "../lib/utils";
import { Heart, Share2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";
import { ProfitProduct } from "../lib/profitFilter";

const LISTING_LIMIT = 30;
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;
const SHIPPING_COST = 2500;

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
  if (rate >= 100) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-black px-2.5 py-1 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-sm">
      🔥 +{rate}%
    </span>
  );
  if (rate >= 50) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-black px-2.5 py-1 rounded-full bg-red-500 text-white shadow-sm">
      🔥 +{rate}%
    </span>
  );
  if (rate >= 30) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500 text-white">
      ↑ +{rate}%
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-400 text-white">
      +{rate}%
    </span>
  );
}

export default function ProductCard({ product }: { product: ProfitProduct }) {
  const { source } = product;
  const sourceUrl = toRakutenAffiliateUrl(source.url);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);
  const [listingCount, setListingCount] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    fetch(`/api/listing-count/${product.id}`)
      .then((r) => r.json())
      .then((d) => setListingCount(d.count ?? 0))
      .catch(() => {});
  }, [product.id]);

  const limitReached = listingCount >= LISTING_LIMIT;

  const shareOnX = () => {
    const text = `【転売リサーチ】${product.title}\n仕入れ: ${formatJpy(source.price)} → eBay利益率${product.realProfitRate}%！\n#転売 #eBay #輸出副業`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.yushutsu-fukugyo.com")}`, "_blank");
  };

  const isHot = product.realProfitRate >= 50;
  const pointAmount = source.pointAmount ?? 0;
  const realCost = source.price - pointAmount;
  const ebayFee = Math.round(product.realAvgPrice * EBAY_FEE_RATE) + EBAY_FEE_FIXED;

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
          <div className="shrink-0">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.title} className="w-20 h-20 rounded-xl object-cover bg-gray-100" />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 flex items-center justify-center text-3xl">📦</div>
            )}
          </div>
          <div className="flex-1 min-w-0">
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
            <h3 className="text-[13px] font-medium text-gray-800 leading-snug line-clamp-2">
              {product.title}
            </h3>
          </div>
        </div>

        {/* ━━━ 価格フロー（ポイント込み強調） ━━━ */}
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-1">
          {/* 楽天仕入れ → eBay売値 */}
          <div className="flex items-center gap-2 mb-2">
            {/* 楽天仕入れ */}
            <div className="min-w-0">
              <p className="text-[10px] text-gray-400 font-medium mb-0.5">楽天仕入れ</p>
              <p className="text-sm font-bold text-gray-700">{formatJpy(source.price)}</p>
              {pointAmount > 0 && (
                <p className="text-[11px] font-bold text-orange-500 mt-0.5">
                  実質 {formatJpy(realCost)}
                </p>
              )}
            </div>

            <span className="text-gray-300 text-lg shrink-0">→</span>

            {/* eBay売値 */}
            <div className="min-w-0">
              <p className="text-[10px] text-blue-500 font-medium mb-0.5">eBay平均落札</p>
              <p className="text-sm font-bold text-blue-600">{formatJpy(product.realAvgPrice)}</p>
            </div>

            <div className="w-px h-8 bg-gray-200 mx-0.5 shrink-0" />

            {/* 利益 */}
            <div className="flex-1 text-right">
              <p className="text-[10px] text-emerald-600 font-medium mb-0.5">利益（手数料後）</p>
              <p className="text-lg font-black text-emerald-600 leading-none">
                {formatJpy(product.realProfit)}
              </p>
              {pointAmount > 0 && (
                <p className="text-[11px] font-bold text-orange-500 mt-0.5">
                  + {pointAmount.toLocaleString()}pt
                </p>
              )}
            </div>
          </div>

          {/* ポイント還元バー */}
          {pointAmount > 0 && (
            <div className="flex items-center gap-1.5 bg-orange-50 border border-orange-100 rounded-lg px-2.5 py-1.5 mb-2">
              <span className="text-sm">🎁</span>
              <span className="text-[12px] font-bold text-orange-600">
                楽天ポイント {pointAmount.toLocaleString()}pt 還元
              </span>
              <span className="text-[11px] text-orange-400 ml-auto">
                （{source.pointRate ?? 1}%）
              </span>
            </div>
          )}

          {/* 落札実績 */}
          {product.realCount > 0 && (
            <div className="flex items-center justify-between pt-1.5 border-t border-gray-200">
              <div className="flex items-center gap-1">
                <TrendingUp size={11} className="text-blue-400" />
                <span className="text-[11px] text-gray-400">eBay落札実績</span>
                <span className="text-[11px] font-bold text-blue-500">{product.realCount}件</span>
              </div>
              {product.ebaySoldUrl && (
                <a href={product.ebaySoldUrl} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] text-indigo-400 font-medium hover:text-indigo-600">
                  実績を見る ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* 明細の展開ボタン */}
        <button
          onClick={() => setShowBreakdown(v => !v)}
          className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 py-1 mb-2 hover:text-gray-600 transition-colors"
        >
          {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showBreakdown ? "明細を閉じる" : "利益の計算内訳を見る"}
        </button>

        {/* 明細パネル */}
        {showBreakdown && (
          <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-2 text-[12px] text-gray-600 space-y-1.5">
            <div className="flex justify-between">
              <span>eBay平均落札価格</span>
              <span className="font-semibold text-blue-600">+ {formatJpy(product.realAvgPrice)}</span>
            </div>
            <div className="flex justify-between text-red-500">
              <span>楽天仕入れ価格</span>
              <span>- {formatJpy(source.price)}</span>
            </div>
            {pointAmount > 0 && (
              <div className="flex justify-between text-orange-500">
                <span>楽天ポイント還元（{source.pointRate ?? 1}%）</span>
                <span>+ {formatJpy(pointAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-red-500">
              <span>eBay手数料（13.25% + ¥47）</span>
              <span>- {formatJpy(ebayFee)}</span>
            </div>
            <div className="flex justify-between text-red-500">
              <span>国際送料（目安）</span>
              <span>- {formatJpy(SHIPPING_COST)}</span>
            </div>
            <div className="flex justify-between font-bold text-emerald-600 pt-1.5 border-t border-gray-200">
              <span>利益</span>
              <span>
                {formatJpy(product.realProfit)}
                {pointAmount > 0 && (
                  <span className="text-orange-500 ml-1">+ {pointAmount.toLocaleString()}pt</span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* アクションボタン群 */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center py-2.5 bg-indigo-600 active:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors">
              楽天で仕入れる ↗
            </a>
            <button onClick={toggleFav}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded-xl border-2 transition-colors",
                isFav ? "bg-rose-50 border-rose-300 text-rose-500" : "bg-gray-50 border-gray-200 text-gray-300"
              )}>
              <Heart size={16} fill={isFav ? "currentColor" : "none"} />
            </button>
            <button onClick={shareOnX}
              className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100">
              <Share2 size={16} />
            </button>
          </div>
          {!limitReached && (
            <ListingHelper product={product} onCountChange={setListingCount} />
          )}
        </div>
      </div>
    </div>
  );
}
