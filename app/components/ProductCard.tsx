"use client";
import { formatJpy, cn, toRakutenAffiliateUrl, safeHttpUrl } from "../lib/utils";
import { Heart, Share2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";
import { ProfitProduct } from "../lib/profitFilter";

const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;
const SHIPPING_COST = 2500;

function getListingLimit(avgDaysToSell?: number): number {
  if (avgDaysToSell === undefined || avgDaysToSell === null) return 30;
  if (avgDaysToSell < 10)  return 100;
  if (avgDaysToSell < 20)  return 50;
  if (avgDaysToSell < 30)  return 40;
  return 30;
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

function PointBadge({ rate }: { rate: number }) {
  if (rate <= 1) return null;
  return (
    <span className="inline-flex items-center text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FF4466] text-white leading-none">
      {rate}倍
    </span>
  );
}

function ProfitRateBadge({ rate }: { rate: number }) {
  const bg = rate >= 50
    ? "bg-gradient-to-r from-[#CC0033] to-[#FF4466]"
    : rate >= 30
    ? "bg-gradient-to-r from-orange-500 to-amber-400"
    : "bg-gradient-to-r from-amber-500 to-yellow-400";
  return (
    <span className={`inline-flex items-center text-[13px] font-black px-2.5 py-1.5 rounded-full text-white leading-none ${bg}`}>
      利益率 {rate}%
    </span>
  );
}

function TrustBadge({ count }: { count: number }) {
  if (count >= 15) return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-orange-500">🔥 信頼大</span>
  );
  if (count >= 10) return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600">✅ 信頼中</span>
  );
  if (count >= 5) return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-blue-500">🔵 信頼小</span>
  );
  // 逆引きフローでは eBay で実際に売れた確定価格をベースにしているため肯定的に表示
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600">✅ eBay実売価格</span>
  );
}

export default function ProductCard({ product }: { product: ProfitProduct }) {
  const { source } = product;
  const sourceUrl = toRakutenAffiliateUrl(source.url);
  const ebaySoldUrl = safeHttpUrl(product.ebaySoldUrl);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);
  const [listingCount, setListingCount] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    fetch(`/api/listing-count/${product.id}`)
      .then((r) => r.json())
      .then((d) => setListingCount(d.count ?? 0))
      .catch(() => {});
  }, [product.id]);

  const listingLimit = getListingLimit(product.avgDaysToSell);
  const limitReached = listingCount >= listingLimit;

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
      "shadow-sm hover:shadow-md border border-gray-100",
      (product.soldOut || limitReached) && "opacity-50"
    )}>

      {/* HOT グラデーションライン */}
      {isHot && !product.soldOut && (
        <div className="h-1 bg-gradient-to-r from-[#CC0033] via-[#FF4466] to-[#FF6B6B]" />
      )}

      {product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="rotate-[-20deg] border-4 border-red-400 text-red-400 text-2xl font-black px-4 py-1 rounded-xl tracking-widest opacity-80">SOLD</span>
        </div>
      )}
      {limitReached && !product.soldOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/85 p-4 rounded-2xl">
          <div className="bg-white rounded-xl px-4 py-3 text-center shadow-lg border border-gray-100">
            <p className="text-sm font-bold text-gray-700">出品上限に達しました</p>
            <p className="text-xs text-gray-400 mt-1">市場の乱立防止のため紹介終了</p>
          </div>
        </div>
      )}

      <div className="p-4">
        {/* 上段：画像 + 商品情報 */}
        <div className="flex gap-3 mb-3">
          {/* 画像 */}
          <div className="shrink-0 relative">
            <a href={`/search?q=${encodeURIComponent(product.title.slice(0, 30))}`} className="block" aria-label="同名商品を再検索">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.title}
                className="w-[88px] h-[88px] object-cover rounded-xl bg-gray-50 border border-gray-100" />
            ) : (
              <div aria-hidden="true" className="w-[88px] h-[88px] bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center text-3xl">📦</div>
            )}
            </a>
            {isHot && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-black bg-gradient-to-r from-[#CC0033] to-[#FF4466] text-white px-1.5 py-0.5 rounded-full leading-none shadow-sm">
                急騰
              </span>
            )}
          </div>

          {/* 商品情報 */}
          <div className="flex-1 min-w-0">
            {/* バッジ行 */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              {product.isNew && (
                <span className="text-[10px] font-bold border border-[#CC0033] text-[#CC0033] px-1.5 py-0.5 rounded-full leading-none">新品</span>
              )}
              <PointBadge rate={source.pointRate ?? 1} />
            </div>

            {/* タイトル */}
            <h3 className="text-[13px] text-gray-800 leading-snug line-clamp-2 mb-2 font-medium">
              {product.title}
            </h3>

            {/* 楽天仕入れ価格 */}
            <div className="flex items-baseline gap-1">
              <span className="text-[10px] text-gray-400">仕入れ</span>
              <span className="text-base font-black text-[#CC0033]">
                {formatJpy(source.price)}
              </span>
            </div>

            {/* ポイント還元 */}
            {pointAmount > 0 && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="inline-flex w-3.5 h-3.5 bg-[#FF4466] rounded-full items-center justify-center text-white font-black text-[7px] shrink-0">R</span>
                <span className="text-[11px] font-bold text-[#FF4466]">
                  {pointAmount.toLocaleString()}pt
                </span>
                <span className="text-[10px] text-gray-400">({source.pointRate ?? 1}%還元)</span>
              </div>
            )}
          </div>
        </div>

        {/* eBay価格・利益エリア */}
        <div className="bg-[#F5F7FA] rounded-xl px-3 py-2.5 mb-3">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0">
              <p className="text-[11px] text-gray-500 mb-0.5">eBay平均落札</p>
              <p className="text-base font-black text-blue-600 whitespace-nowrap">{formatJpy(product.realAvgPrice)}</p>
              {product.realCount > 0 && (
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <p className="text-xs text-gray-500">{product.realCount}件</p>
                  <TrustBadge count={product.realCount} />
                  {product.avgDaysToSell != null && (
                    <span className="text-xs text-gray-500">平均{product.avgDaysToSell}日</span>
                  )}
                  {ebaySoldUrl && (
                    <a href={ebaySoldUrl} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="eBayの直近の落札実績を見る"
                      className="inline-flex items-center gap-0.5 text-[11px] text-blue-500 font-bold hover:underline py-1">
                      実績 <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
            </div>

            <div aria-hidden="true" className="text-gray-300 text-xl mx-1 shrink-0">→</div>

            {/* 利益 */}
            <div className="text-right shrink-0">
              <ProfitRateBadge rate={product.realProfitRate} />
              <p className="text-[11px] text-gray-500 mt-1">実質利益（ポイント込み）</p>
              <p className="text-2xl font-black text-[#CC0033] leading-tight whitespace-nowrap">
                {formatJpy(product.realProfit + pointAmount)}
              </p>
              {pointAmount > 0 && (
                <p className="text-[11px] text-gray-500">うちポイント {pointAmount.toLocaleString()}pt</p>
              )}
            </div>
          </div>

          {/* ポイント還元バー */}
          {pointAmount > 0 && (
            <div className="mt-2 bg-white rounded-lg px-2.5 py-1.5 flex items-center gap-2 border border-[#FF4466]/20">
              <span className="inline-flex w-4 h-4 bg-[#FF4466] rounded-full items-center justify-center text-white font-black text-[8px] shrink-0">R</span>
              <span className="text-[11px] font-bold text-[#FF4466]">
                楽天ポイント {pointAmount.toLocaleString()}pt 獲得
              </span>
              <span className="text-[11px] text-gray-500 ml-auto">実質 {formatJpy(realCost)}</span>
            </div>
          )}
        </div>

        {/* 明細の展開ボタン */}
        <button
          onClick={() => setShowBreakdown(v => !v)}
          aria-expanded={showBreakdown}
          className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 py-2.5 mb-1 hover:text-gray-700 active:text-gray-800 transition-colors"
        >
          {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {showBreakdown ? "内訳を閉じる" : "利益の計算内訳を見る"}
        </button>

        {/* 明細パネル */}
        {showBreakdown && (
          <div className="bg-[#F5F7FA] rounded-xl px-3 py-2.5 mb-3 text-[12px] text-gray-600 space-y-1.5">
            <div className="flex justify-between">
              <span>eBay平均落札価格</span>
              <span className="font-semibold text-blue-600">+ {formatJpy(product.realAvgPrice)}</span>
            </div>
            <div className="flex justify-between text-[#CC0033]">
              <span>楽天仕入れ価格</span>
              <span>- {formatJpy(source.price)}</span>
            </div>
            {pointAmount > 0 && (
              <div className="flex justify-between text-[#FF4466]">
                <span>楽天ポイント還元（{source.pointRate ?? 1}%）</span>
                <span>+ {formatJpy(pointAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#CC0033]">
              <span>eBay手数料（13.25% + ¥47）</span>
              <span>- {formatJpy(ebayFee)}</span>
            </div>
            <div className="flex justify-between text-[#CC0033]">
              <span>国際送料（目安）</span>
              <span>- {formatJpy(SHIPPING_COST)}</span>
            </div>
            <div className="flex justify-between font-black text-[#CC0033] pt-1.5 border-t border-gray-200 text-[13px]">
              <span>実質利益合計</span>
              <span>{formatJpy(product.realProfit + pointAmount)}</span>
            </div>
            {pointAmount > 0 && (
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>内訳: 売却益 + ポイント{source.pointRate}%</span>
                <span>{formatJpy(product.realProfit)} + {pointAmount.toLocaleString()}pt</span>
              </div>
            )}
          </div>
        )}

        {/* アクションボタン（全て高さ44pxで統一） */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 bg-gradient-to-r from-[#CC0033] to-[#E8003A] hover:from-[#AA0028] hover:to-[#CC0033] active:scale-[0.99] text-white text-sm font-bold rounded-xl transition-all shadow-sm whitespace-nowrap">
              <span className="inline-flex w-4 h-4 bg-white rounded-full items-center justify-center text-[#CC0033] font-black text-[9px] shrink-0">R</span>
              楽天で仕入れる
            </a>
            <button onClick={toggleFav}
              aria-label={isFav ? "お気に入りから削除" : "お気に入りに追加"}
              aria-pressed={isFav}
              className={cn(
                "w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border-2 transition-colors active:scale-95",
                isFav ? "bg-red-50 border-[#CC0033] text-[#CC0033]" : "bg-gray-50 border-gray-200 text-gray-400"
              )}>
              <Heart size={18} fill={isFav ? "currentColor" : "none"} />
            </button>
            <button onClick={shareOnX}
              aria-label="Xでシェア"
              className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100 active:scale-95">
              <Share2 size={18} />
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
