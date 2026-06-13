"use client";
import { formatJpy, cn, toRakutenAffiliateUrl, toEbayMarketUrl } from "../lib/utils";
import { Heart, Share2, ChevronDown, ChevronUp, ExternalLink, Flame, BadgeCheck, Package } from "lucide-react";
import Link from "next/link";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";
import { ProfitProduct } from "../lib/profitFilter";
import { isSold } from "../lib/sold";
import { track } from "../lib/analytics";

const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;

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
    ? "bg-[#BF0000]"
    : rate >= 30
    ? "bg-orange-500"
    : "bg-amber-500";
  return (
    <span className={`inline-flex items-center text-xs font-black px-2.5 py-1 rounded-full text-white leading-none ${bg}`}>
      利益率 {rate}%
    </span>
  );
}

function TrustBadge({ count }: { count: number }) {
  if (count >= 15) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-500"><Flame size={12} />信頼大</span>
  );
  if (count >= 10) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><BadgeCheck size={12} />信頼中</span>
  );
  if (count >= 5) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-500"><BadgeCheck size={12} />信頼小</span>
  );
  // eBay の現在の出品価格（日本セラー・新品）をベースにしているため肯定的に表示
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><BadgeCheck size={12} />eBay相場価格</span>
  );
}

export default function ProductCard({ product, ebaySold = false, autoOpenListing = false }: { product: ProfitProduct; ebaySold?: boolean; autoOpenListing?: boolean }) {
  const { source } = product;
  const sourceUrl = toRakutenAffiliateUrl(source.url);
  // eBayタイトル全文は特定的すぎて検索が0件→無関係品になる。主要語に絞り、かつ
  // 表示中のeBay金額(realAvgPrice)を下回る出品はリンク先に出さない（_udloフロア）。
  const ebayMarketUrl = toEbayMarketUrl(product.coreKeyword || product.title, product.realAvgPrice, (product as { market?: string }).market);
  const { isFav, toggle: toggleFav } = useFavorite(product.id);
  // 出品者数(下書き含む)は /api/products が付与済み。SOLD判定に使う。計上はサーバー側。
  const listingCount = product.listingCount ?? 0;
  const [showBreakdown, setShowBreakdown] = useState(false);

  // 「楽天で仕入れる」を押した端末だけ「eBay簡単出品」を解放（無在庫の軽い抑止）。端末localStorageで保持。
  const [rakutenClicked, setRakutenClicked] = useState(false);
  useEffect(() => {
    try { setRakutenClicked(localStorage.getItem(`rkt_${product.id}`) === "1"); } catch { /* noop */ }
  }, [product.id]);
  const markRakutenClicked = () => {
    try { localStorage.setItem(`rkt_${product.id}`, "1"); } catch { /* noop */ }
    setRakutenClicked(true);
    track("rakuten_buy_click", { product_id: product.id, profit_rate: product.realProfitRate });
  };

  // 「楽天で仕入れる」を押した端末(=仕入れ中)には SOLD を出さない。仕入れ途中で他人の出品が増えて
  // SOLD化すると、買ったのに出品導線が消えてかわいそうなため、本人にはそのまま表示する。
  const sold = isSold(product, listingCount) && !rakutenClicked;

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
      "relative isolate bg-white rounded-2xl overflow-hidden transition-all shadow-sm hover:shadow-md border",
      ebaySold ? "border-emerald-200" : "border-gray-100"
    )}>

      {/* eBayで売却済み：仕入れ→発送を促す帯（最下部に沈むカードの目印） */}
      {ebaySold && (
        <div className="bg-emerald-50 border-b border-emerald-100 px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
          <BadgeCheck size={13} /> eBayで売却済み — 楽天で仕入れて発送しよう
        </div>
      )}

      {/* HOT グラデーションライン */}
      {isHot && !sold && !ebaySold && (
        <div className="h-1 bg-gradient-to-r from-[#BF0000] to-[#FF4466]" />
      )}

      {/* SOLD: 商品情報をぼかして SOLD札 + 説明を重ねる（z-10=固定ヘッダーより下） */}
      {sold && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-4 text-center">
          <span className="rotate-[-12deg] bg-[#BF0000] text-white text-2xl font-black px-6 py-1.5 rounded-xl tracking-[0.2em] shadow-lg">SOLD</span>
          <p className="mt-3 text-[11px] font-bold text-gray-700 bg-white/95 rounded-xl px-3 py-2 max-w-[290px] leading-relaxed shadow-sm border border-gray-100">
            ライバルが増えてきたので、この商品は一旦SOLDにしたよ<br />
            他にも狙い目はいっぱいあるよ！早い者勝ちだよ。
          </p>
        </div>
      )}

      <div className={cn("p-4", sold && "blur-[6px] pointer-events-none select-none")}>
        {/* 上段：画像 + 商品情報 */}
        <div className="flex gap-3.5 mb-4">
          {/* 画像 */}
          <div className="shrink-0 relative">
            <a href={`/search?q=${encodeURIComponent(product.title.slice(0, 30))}`} className="block" aria-label="同名商品を再検索">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.title}
                className="w-[92px] h-[92px] object-cover rounded-xl bg-gray-50 border border-gray-100" />
            ) : (
              <div aria-hidden="true" className="w-[92px] h-[92px] bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center text-gray-300"><Package size={30} /></div>
            )}
            </a>
            {isHot && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-black bg-[#BF0000] text-white px-1.5 py-0.5 rounded-full leading-none shadow-sm">
                急騰
              </span>
            )}
          </div>

          {/* 商品情報 */}
          <div className="flex-1 min-w-0">
            {/* バッジ行 */}
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {product.isNew && (
                <span className="text-[10px] font-bold border border-[#BF0000] text-[#BF0000] px-2 py-0.5 rounded-full leading-none">新品</span>
              )}
              <PointBadge rate={source.pointRate ?? 1} />
            </div>

            {/* タイトル */}
            <h3 className="text-[13px] text-gray-800 leading-snug line-clamp-2 mb-3 font-medium">
              {product.title}
            </h3>

            {/* 楽天仕入れ価格 */}
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-gray-400">仕入れ</span>
              <span className="text-lg font-black text-[#BF0000]">
                {formatJpy(source.price)}
              </span>
              {pointAmount > 0 && (
                <span className="text-[11px] text-gray-400">／ {source.pointRate ?? 1}%還元</span>
              )}
            </div>
          </div>
        </div>

        {/* eBay価格・利益エリア — 想定売値 → 利益を主役に */}
        <div className="bg-[#F8F9FB] rounded-xl p-4 mb-3 border border-gray-100">
          {/* 想定売値 */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-gray-400">eBayの想定売値</span>
            <span className="text-lg font-bold text-blue-600 whitespace-nowrap">{formatJpy(product.realAvgPrice)}</span>
          </div>

          {/* 利益（ヒーロー） */}
          <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-end justify-between gap-2">
            <div className="shrink-0">
              <p className="text-xs text-gray-400 mb-1">実質利益（ポイント込み）</p>
              <ProfitRateBadge rate={product.realProfitRate} />
            </div>
            <p className="text-3xl font-black text-[#BF0000] leading-none whitespace-nowrap">
              {formatJpy(product.realProfit + pointAmount)}
            </p>
          </div>

          {/* 信頼バッジ・相場リンク */}
          {product.realCount > 0 && (
            <div className="flex items-center gap-x-3 gap-y-1 mt-3 flex-wrap">
              <TrustBadge count={product.realCount} />
              {product.avgDaysToSell != null && (
                <span className="text-xs text-gray-400">落札まで平均{product.avgDaysToSell}日</span>
              )}
              {ebayMarketUrl && (
                <a href={ebayMarketUrl} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="eBayでこの価格以上の出品を確認する"
                  className="inline-flex items-center gap-0.5 text-xs text-blue-500 font-bold hover:underline ml-auto py-1">
                  eBayで相場を確認 <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}

          {/* ポイント二重取り — 1行強調 */}
          {pointAmount > 0 && (
            <div className="mt-3 bg-white rounded-xl px-3 py-2 flex items-center gap-2 border border-[#FF4466]/20">
              <span className="inline-flex w-4 h-4 bg-[#FF4466] rounded-full items-center justify-center text-white font-black text-[8px] shrink-0">R</span>
              <span className="text-xs font-bold text-[#FF4466]">
                楽天ポイント {pointAmount.toLocaleString()}pt 二重取り
              </span>
              <span className="text-xs text-gray-400 ml-auto">実質 {formatJpy(realCost)}</span>
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
          <div className="bg-[#F8F9FB] rounded-xl p-4 mb-3 text-[12px] text-gray-600 space-y-1.5 border border-gray-100">
            <div className="flex justify-between">
              <span>eBayの想定売値（相場ベース）</span>
              <span className="font-semibold text-blue-600">+ {formatJpy(product.realAvgPrice)}</span>
            </div>
            <div className="flex justify-between text-[#BF0000]">
              <span>楽天仕入れ価格</span>
              <span>- {formatJpy(source.price)}</span>
            </div>
            {pointAmount > 0 && (
              <div className="flex justify-between text-[#FF4466]">
                <span>楽天ポイント還元（{source.pointRate ?? 1}%）</span>
                <span>+ {formatJpy(pointAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#BF0000]">
              <span>eBay手数料（13.25% + ¥47）</span>
              <span>- {formatJpy(ebayFee)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>国際送料</span>
              <span className="font-bold text-emerald-600">購入者負担（¥0）</span>
            </div>
            <div className="flex justify-between font-black text-[#BF0000] pt-1.5 border-t border-gray-200 text-[13px]">
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

        {/* アクションボタン：楽天 と eBay を横並び・等幅。補助(お気に入り/シェア)は下段 */}
        <div className="space-y-2.5">
          {/* 主要CTA — 楽天で仕入れる / eBay簡単出品 を横並び（flex-1で等幅） */}
          <div className="flex gap-2.5">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" onClick={markRakutenClicked}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-12 bg-[#BF0000] hover:bg-[#9E0000] active:scale-[0.99] text-white text-sm font-bold rounded-xl transition-all shadow-sm whitespace-nowrap">
              <span className="inline-flex w-4 h-4 bg-white rounded-full items-center justify-center text-[#BF0000] font-black text-[9px] shrink-0">R</span>
              楽天で仕入れる
            </a>
            {!sold && (
              <ListingHelper product={product} unlocked={rakutenClicked} autoOpen={autoOpenListing} />
            )}
          </div>

          {/* お気に入り・シェア — 2分割の補助行 */}
          <div className="flex gap-2.5">
            <button onClick={toggleFav}
              aria-label={isFav ? "お気に入りから削除" : "お気に入りに追加"}
              aria-pressed={isFav}
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl border text-xs font-bold transition-colors active:scale-95",
                isFav ? "bg-red-50 border-[#BF0000] text-[#BF0000]" : "bg-gray-50 border-gray-100 text-gray-500"
              )}>
              <Heart size={15} fill={isFav ? "currentColor" : "none"} />
              {isFav ? "お気に入り済" : "お気に入り"}
            </button>
            <button onClick={shareOnX}
              aria-label="Xでシェア"
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl border border-gray-100 bg-gray-50 text-gray-500 active:bg-gray-100 active:scale-95 text-xs font-bold">
              <Share2 size={15} />
              シェア
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
