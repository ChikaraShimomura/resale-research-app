"use client";
import { formatJpy, cn, toRakutenProductUrl, toEbayMarketUrl } from "../lib/utils";
import { ChevronDown, ChevronUp, ExternalLink, Flame, BadgeCheck } from "lucide-react";
import ListingHelper from "./ListingHelper";
import { useState, useEffect } from "react";
import { ProfitProduct } from "../lib/profitFilter";
import { track, logEvent } from "../lib/analytics";
import { cleanImg } from "../lib/cleanImg";

const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED = 47;

function PointBadge({ rate }: { rate: number }) {
  if (rate <= 1) return null;
  return (
    <span className="inline-flex items-center text-[10px] font-black px-2 py-0.5 rounded-full bg-[#5A6472] text-white leading-none">
      {rate}倍
    </span>
  );
}

function ProfitRateBadge({ rate }: { rate: number }) {
  const bg = rate >= 50
    ? "bg-[#2D323B]"
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
  // eBay の現在の出品（日本セラー・新品）の最安をベースにしているため肯定的に表示
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><BadgeCheck size={12} />eBay最安ベース</span>
  );
}

export default function ProductCard({ product, ebaySold = false, autoOpenListing = false }: { product: ProfitProduct; ebaySold?: boolean; autoOpenListing?: boolean }) {
  const { source } = product;
  // 仕入れボタン/画像リンクは楽天の直リンク（非アフィリエイト）。アフィリ中継が混ざっていても剥がして直URLにする。
  const sourceUrl = toRakutenProductUrl(source.url);
  // eBayタイトル全文は特定的すぎて検索が0件→無関係品になる。主要語に絞り、かつ
  // 表示中のeBay金額(realAvgPrice)を下回る出品はリンク先に出さない（_udloフロア）。
  // 「相場を確認」は、画像照合で一致した実物(matchedEbayUrl)を最優先＝必ず同一商品に着地。
  // 無い(旧データ)時だけ、締めたキーワード検索にフォールバック。
  const ebayMarketUrl = product.matchedEbayUrl || toEbayMarketUrl(product.coreKeyword || product.title, (product as { market?: string }).market);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [imgError, setImgError] = useState(false); // 画像が読み込めない(リンク切れ)時はカードごと出さない

  // 「楽天で仕入れる」を押した端末を localStorage(rkt_) に記録する。オンボーディングの「仕入れた」判定に使う。
  const markRakutenClicked = () => {
    try { localStorage.setItem(`rkt_${product.id}`, "1"); } catch { /* noop */ }
    track("rakuten_buy_click", { product_id: product.id, profit_rate: product.realProfitRate });
    logEvent("rakuten_buy");
    recordSourcing();
  };

  // 仕入れ中としてアカウントに記録（別端末でもマイページの仕入れ中一覧に出る／カタログ非依存のスナップショット保存）。
  // スマホで楽天アプリへ遷移するとブラウザがバックグラウンド化し通常の fetch は中断されるため、
  // ページ離脱でも確実に送れる sendBeacon を使う（不可なら keepalive 付き fetch にフォールバック）。
  const recordSourcing = () => {
    const body = JSON.stringify({
      action: "add",
      productId: product.id,
      title: product.title,
      imageUrl: product.imageUrl,
      purchase: (source.price ?? 0) + (source.shippingJpy ?? 0),
      points: source.pointAmount ?? 0,
    });
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon &&
          navigator.sendBeacon("/api/ebay/sourcing", new Blob([body], { type: "application/json" }))) {
        return; // 送信キューに入った
      }
    } catch { /* fall through to fetch */ }
    try {
      fetch("/api/ebay/sourcing", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch { /* noop */ }
  };

  const isHot = product.realProfitRate >= 50;
  const pointAmount = source.pointAmount ?? 0;
  const shippingJpy = source.shippingJpy ?? 0; // 国内送料概算（利益計算に算入済み）
  const ebayFee = Math.round(product.realAvgPrice * EBAY_FEE_RATE) + EBAY_FEE_FIXED;
  // 内訳が realProfit（現金純利益＝ポイント抜き・国際送料/米国関税の控除後）に必ず一致するよう、
  // 差分を「国際発送まわりの目安（送料のeBay手数料＋関税）」として1行に束ねる。
  const intlAndDuty = Math.max(0, Math.round(product.realAvgPrice - source.price - shippingJpy - ebayFee - product.realProfit));

  // 画像が無い／読み込めない（楽天のリンク切れ画像）商品はカードごと出さない＝「画像無し」を防ぐ。
  if (!product.imageUrl || imgError) return null;

  return (
    <div className={cn(
      "relative isolate bg-white rounded-2xl overflow-hidden transition-all shadow-sm hover:shadow-md border",
      ebaySold ? "border-emerald-200" : "border-[#A98B5C]/25"
    )}>

      {/* eBayで売却済み：仕入れ→発送を促す帯（最下部に沈むカードの目印） */}
      {ebaySold && (
        <div className="bg-emerald-50 border-b border-emerald-100 px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
          <BadgeCheck size={13} /> eBayで売却済み — 楽天で仕入れて発送しよう
        </div>
      )}

      {/* HOT グラデーションライン */}
      {isHot && !ebaySold && (
        <div className="h-1 bg-gradient-to-r from-[#2D323B] to-[#A98B5C]" />
      )}

      <div className="p-4">
        {/* 上段：画像 + 商品情報 */}
        <div className="flex gap-3.5 mb-4">
          {/* 画像 */}
          <div className="shrink-0 relative">
            {/* 画像タップ＝楽天で商品を見る（アフィリ付き・新規タブ）。
                ※ これは「見るだけ」。仕入れフラグ(rkt_)は付けない（オンボーディングの仕入れ判定に影響させない）。 */}
            <a href={sourceUrl} rel="noopener noreferrer"
              onClick={() => logEvent("product_view")}
              className="block relative" aria-label="楽天市場でこの商品を見る">
              <img src={cleanImg(product.imageUrl)} alt={product.title}
                onError={() => setImgError(true)}
                // 楽天の画像が消えると 404 で「1x1の極小プレースホルダgif」が返り onError が出ない＝空表示で残る。
                // 読み込めた画像が極小(正規サムネは128px以上)ならリンク切れ扱いにしてカードごと隠す（負荷ゼロ・表示側のみ）。
                onLoad={(e) => { const w = e.currentTarget.naturalWidth; if (w > 0 && w < 16) setImgError(true); }}
                className={`w-[92px] h-[92px] object-cover rounded-xl bg-gray-50 border-2 ${product.realProfitRate >= 30 ? "border-[#A98B5C]" : "border-[#AEB4BD]"}`} />
              <span className="absolute bottom-1 inset-x-1 text-center text-[8px] font-bold text-white bg-black/45 rounded-md py-0.5 leading-none pointer-events-none">
                楽天で見る
              </span>
            </a>
            {isHot && (
              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-black bg-[#2D323B] text-white px-1.5 py-0.5 rounded-full leading-none shadow-sm">
                急騰
              </span>
            )}
          </div>

          {/* 商品情報 */}
          <div className="flex-1 min-w-0">
            {/* バッジ行 */}
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {product.isNew && (
                <span className="text-[10px] font-bold border border-[#2D323B] text-[#2D323B] px-2 py-0.5 rounded-full leading-none">新品</span>
              )}
              <PointBadge rate={source.pointRate ?? 1} />
            </div>

            {/* タイトル */}
            <h3 className="text-[13px] text-gray-800 leading-snug line-clamp-2 mb-3 font-medium">
              {product.title}
            </h3>

            {/* 楽天仕入れ価格 */}
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-gray-400">仕入れ{shippingJpy > 0 ? "(送料込)" : ""}</span>
              <span className="text-lg font-black text-[#2D323B]">
                {formatJpy(source.price + shippingJpy)}
              </span>
              {pointAmount > 0 && (
                <span className="text-[11px] text-gray-400">／ {source.pointRate ?? 1}%還元</span>
              )}
            </div>
          </div>
        </div>

        {/* eBay価格・利益エリア — 想定売値 → 利益を主役に */}
        <div className="bg-[#F8F9FB] rounded-xl p-4 mb-3 border border-[#A98B5C]/25">
          {/* eBay最安値（早く売れる価格）。中央値は小さく併記して価格帯が見えるように。 */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-gray-400">eBay最安値<span className="text-[10px] text-gray-300 ml-0.5">（あなたの想定売値）</span></span>
            <span className="text-lg font-bold text-blue-600 whitespace-nowrap">{formatJpy(product.realAvgPrice)}</span>
          </div>
          {product.realMedianPrice != null && product.realMedianPrice > product.realAvgPrice && (
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <span className="text-[10px] text-gray-400">参考：中央値</span>
              <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatJpy(product.realMedianPrice)}</span>
            </div>
          )}

          {/* 利益（ヒーロー）：利益は現金（円）だけで出す。楽天ポイントは「( + ○○ポイント )」で別物として併記。 */}
          <div className="mt-2.5 pt-2.5 border-t border-[#A98B5C]/25 flex items-end justify-between gap-2">
            <div className="shrink-0">
              <p className="text-xs text-gray-400 mb-1">利益（最安で売れた時）</p>
              <ProfitRateBadge rate={product.realProfitRate} />
            </div>
            <div className="text-right">
              <p className="text-3xl font-black text-[#2D323B] leading-none whitespace-nowrap">
                {formatJpy(product.realProfit)}
              </p>
              {pointAmount > 0 && (
                <p className="text-[12px] font-bold text-[#FF4466] mt-1 whitespace-nowrap">
                  （ + {pointAmount.toLocaleString()}ポイント）
                </p>
              )}
            </div>
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
          <div className="bg-[#F8F9FB] rounded-xl p-4 mb-3 text-[12px] text-gray-600 space-y-1.5 border border-[#A98B5C]/25">
            <div className="flex justify-between">
              <span>eBay最安値（早く売れる価格）</span>
              <span className="font-semibold text-blue-600">+ {formatJpy(product.realAvgPrice)}</span>
            </div>
            <div className="flex justify-between text-[#2D323B]">
              <span>楽天仕入れ価格</span>
              <span>- {formatJpy(source.price)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>国内送料（楽天→自分）</span>
              {shippingJpy > 0 ? (
                <span className="text-[#2D323B]">- {formatJpy(shippingJpy)}（概算）</span>
              ) : (
                <span className="font-bold text-emerald-600">送料込み（¥0）</span>
              )}
            </div>
            <div className="flex justify-between text-[#2D323B]">
              <span>eBay手数料（13.25% + ¥47）</span>
              <span>- {formatJpy(ebayFee)}</span>
            </div>
            {intlAndDuty > 0 && (
              <div className="flex justify-between text-[#2D323B]">
                <span>国際発送まわりの目安（送料の手数料＋関税）</span>
                <span>- {formatJpy(intlAndDuty)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-500">
              <span>国際送料そのもの</span>
              <span className="font-bold text-emerald-600">購入者負担（¥0）</span>
            </div>
            <div className="flex justify-between font-black text-[#2D323B] pt-1.5 border-t border-[#A98B5C]/35 text-[13px]">
              <span>利益（現金）</span>
              <span>{formatJpy(product.realProfit)}</span>
            </div>
            {pointAmount > 0 && (
              <div className="flex justify-between text-[11px] text-[#FF4466] font-bold">
                <span>＋ 楽天ポイント（{source.pointRate ?? 1}%・利益とは別のおまけ）</span>
                <span>{pointAmount.toLocaleString()}ポイント</span>
              </div>
            )}
          </div>
        )}

        {/* 主要CTA — eBay自動出品 / 楽天で仕入れる を横並び（flex-1で等幅・位置を入れ替え済み） */}
        <div className="flex gap-2.5">
          <ListingHelper product={product} autoOpen={autoOpenListing} />
          {/* 同じタブで開く：target="_blank"だと楽天アフィリの中継ページ(hb.afl)が楽天アプリへ飛ばした後、
              中身のない空タブが残り「飛ぶ時も戻った時も真っ白」になるため。同タブなら戻るで輸出ラボへ戻れる。 */}
          <a href={sourceUrl} rel="noopener noreferrer" onClick={markRakutenClicked}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-12 bg-[#BF0000] hover:bg-[#9E0000] active:scale-[0.99] text-white text-sm font-bold rounded-xl transition-all shadow-sm whitespace-nowrap">
            <span className="inline-flex w-4 h-4 bg-white rounded-full items-center justify-center text-[#BF0000] font-black text-[9px] shrink-0">R</span>
            楽天で仕入れる
          </a>
        </div>
      </div>
    </div>
  );
}
