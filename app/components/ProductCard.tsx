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

// 楽天風のポイント倍率バッジ
function PointBadge({ rate }: { rate: number }) {
  if (rate <= 1) return null;
  return (
    <span className="inline-flex items-center text-[10px] font-black px-1.5 py-0.5 rounded bg-[#FF6600] text-white leading-none">
      {rate}倍
    </span>
  );
}

// 利益率バッジ
function ProfitRateBadge({ rate }: { rate: number }) {
  const color = rate >= 50 ? "bg-[#BF0000]" : rate >= 30 ? "bg-orange-500" : "bg-amber-500";
  return (
    <span className={`inline-flex items-center text-[11px] font-black px-2 py-0.5 rounded text-white leading-none ${color}`}>
      利益率 {rate}%
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
      "relative bg-white border border-gray-200 overflow-hidden transition-all",
      "shadow-sm hover:shadow-md",
      (product.soldOut || limitReached) && "opacity-50"
    )}>

      {/* HOTライン */}
      {isHot && !product.soldOut && (
        <div className="h-0.5 bg-[#BF0000]" />
      )}

      {product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="rotate-[-20deg] border-4 border-red-500 text-red-500 text-2xl font-black px-4 py-1 rounded-lg tracking-widest opacity-80">SOLD</span>
        </div>
      )}
      {limitReached && !product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 p-4">
          <div className="bg-white rounded px-4 py-3 text-center shadow border border-gray-200">
            <p className="text-sm font-bold text-gray-700">出品上限に達しました</p>
            <p className="text-xs text-gray-400 mt-1">市場の乱立防止のため紹介終了</p>
          </div>
        </div>
      )}

      <div className="p-3">
        {/* 上段：画像 + 商品情報（楽天スタイル） */}
        <div className="flex gap-3 mb-2">
          {/* 画像 */}
          <div className="shrink-0">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.title}
                className="w-[90px] h-[90px] object-cover bg-gray-50 border border-gray-100" />
            ) : (
              <div className="w-[90px] h-[90px] bg-gray-50 border border-gray-100 flex items-center justify-center text-3xl">📦</div>
            )}
          </div>

          {/* 商品情報 */}
          <div className="flex-1 min-w-0">
            {/* バッジ行 */}
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {isHot && <span className="text-[10px] font-bold bg-[#BF0000] text-white px-1.5 py-0.5 rounded leading-none">急騰中</span>}
              {product.isNew && <span className="text-[10px] font-bold border border-[#BF0000] text-[#BF0000] px-1.5 py-0.5 rounded leading-none">新品</span>}
              <PointBadge rate={source.pointRate ?? 1} />
            </div>

            {/* タイトル */}
            <h3 className="text-[13px] text-gray-800 leading-snug line-clamp-2 mb-1.5">
              {product.title}
            </h3>

            {/* 楽天仕入れ価格 */}
            <div className="mb-0.5">
              <span className="text-[10px] text-gray-400">楽天仕入れ </span>
              <span className="text-base font-black text-[#BF0000]">
                {formatJpy(source.price)}
              </span>
              <span className="text-[11px] text-gray-400 ml-1">（税込）</span>
            </div>

            {/* ポイント還元（楽天風） */}
            {pointAmount > 0 && (
              <div className="flex items-center gap-1">
                {/* Rポイントアイコン風 */}
                <span className="inline-flex w-4 h-4 bg-[#BF0000] rounded-full items-center justify-center text-white font-black text-[8px]">R</span>
                <span className="text-[12px] font-bold text-[#BF0000]">
                  {pointAmount.toLocaleString()}ポイント
                </span>
                <span className="text-[11px] text-gray-400">
                  （{source.pointRate ?? 1}%還元）
                </span>
              </div>
            )}
          </div>
        </div>

        {/* eBay価格・利益表示エリア（楽天カード風の区切り） */}
        <div className="border-t border-dashed border-gray-200 pt-2 mb-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-gray-400">eBay平均落札</p>
              <p className="text-base font-black text-blue-600">{formatJpy(product.realAvgPrice)}</p>
              {product.realCount > 0 && (
                <p className="text-[10px] text-gray-400">{product.realCount}件の落札実績</p>
              )}
            </div>

            {/* 区切り */}
            <div className="text-gray-300 text-xl">→</div>

            {/* 利益 */}
            <div className="text-right">
              <ProfitRateBadge rate={product.realProfitRate} />
              <p className="text-[11px] text-gray-500 mt-1">利益（手数料後）</p>
              <p className="text-xl font-black text-[#BF0000] leading-tight">
                {formatJpy(product.realProfit)}
              </p>
              {pointAmount > 0 && (
                <p className="text-[12px] font-bold text-[#FF6600]">
                  + {pointAmount.toLocaleString()}pt
                </p>
              )}
            </div>
          </div>

          {/* ポイント強調バー（楽天のSPUバー風） */}
          {pointAmount > 0 && (
            <div className="mt-2 bg-[#FFF3E0] border border-[#FF6600]/30 rounded px-2.5 py-1.5 flex items-center gap-2">
              <span className="inline-flex w-5 h-5 bg-[#FF6600] rounded-full items-center justify-center text-white font-black text-[9px] shrink-0">R</span>
              <div className="flex-1">
                <span className="text-[11px] font-bold text-[#FF6600]">
                  楽天ポイント {pointAmount.toLocaleString()}ポイント獲得
                </span>
                <span className="text-[10px] text-gray-500 ml-1">（実質 {formatJpy(realCost)}）</span>
              </div>
            </div>
          )}
        </div>

        {/* 明細の展開ボタン */}
        <button
          onClick={() => setShowBreakdown(v => !v)}
          className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-400 py-1 mb-2 hover:text-gray-600 transition-colors"
        >
          {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showBreakdown ? "内訳を閉じる" : "利益の計算内訳を見る"}
        </button>

        {/* 明細パネル */}
        {showBreakdown && (
          <div className="bg-gray-50 border border-gray-100 px-3 py-2.5 mb-2 text-[12px] text-gray-600 space-y-1.5">
            <div className="flex justify-between">
              <span>eBay平均落札価格</span>
              <span className="font-semibold text-blue-600">+ {formatJpy(product.realAvgPrice)}</span>
            </div>
            <div className="flex justify-between text-[#BF0000]">
              <span>楽天仕入れ価格</span>
              <span>- {formatJpy(source.price)}</span>
            </div>
            {pointAmount > 0 && (
              <div className="flex justify-between text-[#FF6600]">
                <span>楽天ポイント還元（{source.pointRate ?? 1}%）</span>
                <span>+ {formatJpy(pointAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#BF0000]">
              <span>eBay手数料（13.25% + ¥47）</span>
              <span>- {formatJpy(ebayFee)}</span>
            </div>
            <div className="flex justify-between text-[#BF0000]">
              <span>国際送料（目安）</span>
              <span>- {formatJpy(SHIPPING_COST)}</span>
            </div>
            <div className="flex justify-between font-black text-[#BF0000] pt-1.5 border-t border-gray-200 text-[13px]">
              <span>利益合計</span>
              <span>
                {formatJpy(product.realProfit)}
                {pointAmount > 0 && (
                  <span className="text-[#FF6600] ml-1">+ {pointAmount.toLocaleString()}pt</span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* アクションボタン */}
        <div className="space-y-2">
          {/* 楽天で仕入れ（楽天の「カートに入れる」ボタン風） */}
          <div className="flex gap-2">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#BF0000] hover:bg-[#A00000] active:bg-[#900000] text-white text-sm font-bold rounded transition-colors">
              <span className="inline-flex w-4 h-4 bg-white rounded-full items-center justify-center text-[#BF0000] font-black text-[9px]">R</span>
              楽天で仕入れる ↗
            </a>
            <button onClick={toggleFav}
              className={cn(
                "w-10 h-10 flex items-center justify-center rounded border-2 transition-colors",
                isFav ? "bg-red-50 border-[#BF0000] text-[#BF0000]" : "bg-gray-50 border-gray-200 text-gray-300"
              )}>
              <Heart size={16} fill={isFav ? "currentColor" : "none"} />
            </button>
            <button onClick={shareOnX}
              className="w-10 h-10 flex items-center justify-center rounded border-2 border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100">
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
