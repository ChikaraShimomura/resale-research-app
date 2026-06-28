// 利益計算の単一ソース(SSOT)。配信の落札再判定(soldComp)が使う。
// landedCostCore.mjs と同じく .mjs（TS からも node スクリプトからも import 可能）。
// ⚠️同期必須：scripts/refresh.mjs と scripts/restore_product.mjs に同式の calcProfit がミラーで存在する
//   （高コストなマッチング処理への巻き込み回避で今回は据え置き）。式や定数を変えるときは3箇所揃えること。
//   将来この profitCore へ統合してミラーを削除するのが望ましい。
import { EBAY_FEE_RATE } from "./landedCostCore.mjs";

export const EBAY_FEE_FIXED_JPY = Number(process.env.LANDED_EBAY_FEE_FIXED_JPY ?? 47);
export const SHIPPING_COST_JPY = Number(process.env.LANDED_SHIPPING_COST_JPY ?? 0); // 国際送料は買い手負担。国内→自分の着地コストは displayProfit/landedCost で別途。

// 粗利 = eBay価格 -（仕入れ価格 + 国内送料 - 獲得ポイント）- eBay手数料 - 国際送料(0)。
// ここで返す profit は「ポイントを原価控除した粗利」。配信の applyDisplayProfit がポイントを足し戻し、
// 着地コスト(国際送料のeBay手数料+米国関税)を差し引いて“現金純利益”へ変換する（二重計上にならない設計）。
export function calcProfit(rakutenPrice, ebayAvgJpy, pointAmount, domesticShipJpy = 0) {
  const effectiveBuy = rakutenPrice + domesticShipJpy - pointAmount;
  if (effectiveBuy <= 0) return { profit: 0, profitRate: 0 };
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuy - ebayFee - SHIPPING_COST_JPY;
  return { profit, profitRate: Math.round((profit / effectiveBuy) * 100) };
}
