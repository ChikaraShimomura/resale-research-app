import { ProfitProduct } from "./profitFilter";
import { landedCost } from "./ebay/landedCost";
import { USD_JPY } from "./ebay/landedCostCore.mjs"; // SSOT(env駆動/既定155)に統一

// 表示用の「正直な現金純利益」へ変換する単一ソース（配信/ランキング/商品詳細で共用）。
//
// 保存カタログの realProfit は「国際送料前・ポイントを原価から引いて算出した粗利」＝実質ポイント込み。
// ここで2つを行う：
//   (1) ポイントを利益から外す（ポイントはあくまでポイント＝おまけ。source.pointAmount で別表示する）
//   (2) 国際送料(目安)にかかるeBay手数料＋米国関税(目安)を差し引いて、手元に残る現金純利益にする
// 結果：realProfit=現金純利益(円) / realProfitRate=現金原価ベースの利益率(%)。
//        source.pointAmount は変更しない（「( + ○○ポイント )」の別表示に使う）。
//
// ※ calcProfit(refresh) は realProfit を「ポイントを原価控除した粗利」として保存し続ける。
//   ここで pointAmount を足し戻して現金化するので、保存形式を変えなくても二重計上にならない。

// 「現金で稼げる品」の現金純利益率の下限（%）。これ以上＝profitKind:'cash'。
const CASH_PROFIT_FLOOR = 10;
// 「ポイ活専用」の現金純利益率の下限（%）。現金1%以上10%未満＝ポイ活専用。現金<1%(0・マイナス)は論外で非掲載（ユーザー方針2026-06-23）。
const POINTKATSU_FLOOR = Number(process.env.POINTKATSU_FLOOR) || 1;

export function applyDisplayProfit(p: ProfitProduct): ProfitProduct {
  const valueUsd = (p.realAvgPrice || 0) / USD_JPY;
  const landed = landedCost(p.category, valueUsd);
  const point = p.source?.pointAmount ?? 0;
  // 現金原価＝仕入れ価格＋国内送料（ポイントは引かない＝ポイントで利益を底上げしない）。
  const cashBuy = (p.source?.price ?? 0) + (p.source?.shippingJpy ?? 0);
  // 保存 realProfit はポイントを原価控除済み＝現金粗利＋ポイント。pointを引いて現金に戻し、着地コストを差し引く。
  const netCash = Math.round((p.realProfit ?? 0) - point - landed.subtractJpy);
  const cashRate = cashBuy > 0 ? Math.round((netCash / cashBuy) * 100) : 0;
  // 種別（すべて現金純利益率で判定）: ≥10%→cash(現金で稼げる) / 1〜9%→point(ポイ活専用) / <1%(0・マイナス)→none(論外・掲載しない)。
  const profitKind: "cash" | "point" | "none" =
    cashBuy <= 0 || (p.realAvgPrice ?? 0) <= 0 ? "none"
    : cashRate >= CASH_PROFIT_FLOOR ? "cash"
    : cashRate >= POINTKATSU_FLOOR ? "point"
    : "none";
  return { ...p, realProfit: netCash, realProfitRate: cashRate, profitKind };
}
