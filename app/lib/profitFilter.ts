import { Product } from "../types";

export interface ProfitProduct extends Product {
  realAvgPrice: number;  // eBay最安値ベースの参照価格（早く売る前提・円換算）。表示と利益の基準。
  realMedianPrice?: number; // eBay中央値（併記・参考用）
  realProfit: number;    // 利益額
  realProfitRate: number; // 利益率（%）
  realCount: number;     // 相場の参照件数
  addedAt?: string;      // 初回登録時刻（ISO）。登録順ソート用
  listingCount?: number; // eBay自動出品が押された回数（ライバル数の目安）。/api/products が付与
  matchedEbayUrl?: string;      // 画像照合で一致したeBay出品のURL（「相場を確認」を確実に同一商品へ）
  matchedEbayImageUrl?: string; // 同・画像（監査用）
  matchedEbayTitle?: string;    // 同・タイトル（監査・相場絞り込み用）
  jan?: string;                 // 仕入れ元の商品名/説明から抽出したJAN/EAN。eBay出品で product.ean に載せる→カタログ一致時にeBayが公式ストック画像/必須項目を自動添付(正規ルート・fail-open)
  restored?: boolean;           // 運営が手動で復活させた商品（一覧の先頭に固定して見つけやすくする）
  // 直近落札ベースの相場（ebaySoldWorker が ebay_soldprice:{id} に保存→配信時 applySoldComp が反映）。
  soldBased?: boolean;          // true なら realAvgPrice/利益は「eBay直近落札中央値」ベース（false/未設定＝現在出品相場）
  soldCount30d?: number;        // 直近windowDays(既定30日)の落札件数（需要の目安バッジ）
  ebayActiveCount?: number;     // eBay現在出品の総数（競合の厚み）。refreshが焼き込み。STR(売れやすさ)=soldCount30d÷これ
  soldWindowDays?: number;      // 落札件数の対象日数（既定30）
  soldUrl?: string;             // AI同一判定が通った実物の落札URL（確認リンクを同一商品に着地させる）
  soldVerified?: boolean;       // AI画像で同一商品の落札を確認済み＝掲載対象（未確定は利益商品に載せない・ユーザー方針2026-06-23）
  // 利益の種類（applyDisplayProfit が現金純利益率で判定・ユーザー方針2026-06-23）。
  profitKind?: "cash" | "point" | "none"; // cash=現金純利益率≥10%(現金で稼げる) / point=現金1〜9%(ポイ活専用) / none=現金<1%(0・マイナスは論外で掲載しない)
  // 未購読(free)向けのマスク版か。true の時はサーバー側で利益額・価格・仕入れ先URL・eBay相場/照合リンクを除去済み
  // （タイトル/画像/利益率だけのティーザー）。ProductCard はこの時マスク表示にする。漏洩防止のためマスクは必ずサーバー側で行う。
  masked?: boolean;
}
