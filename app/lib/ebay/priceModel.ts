// 出品価格モデルの単一の真実(SSOT)。
// 商品管理 /manage の価格変更ボタン(priceTiers) と eBay自動出品モーダル(EbayListingModal) の
// 「±0出品 / 最安 / 中央値 / 高値」を【同じ式・同じ入力】で出す＝2画面で金額が食い違わない。
//
// 設計の肝（赤字を絶対に出さないため）:
//  - 着地コスト(国際送料へのeBay手数料+米国関税+定額送料の不足)は「売価(valueUsd)」依存で、
//    $100超で関税、$120超でEMS(高い送料)、重量>2kgでもEMSに跳ねる＝floorは価格でしきい値を持つ。
//  - ゆえに損益分岐は「その価格自身」で着地コストを評価しないと正しくない（中央値や別の価格で評価すると
//    しきい値をまたいだ時に過小/過大になる＝従来バグ）。±0は不動点反復で自己整合に求める。
//  - 各段(最安/中央/高値)も「その価格自身の損益分岐」を絶対に割らないようクランプ＝しきい値直上の
//    “損失帯”(関税が乗るのに値上げが追いつかない区間)にも価格が落ちない。
import { landedCostForWeight, USD_JPY } from "./landedCost";

export const FEE_RATE = 0.1325; // eBay最終手数料率
export const FEE_FIXED_JPY = 47; // eBay固定手数料
export const FAST_DISCOUNT = 0.08; // 「最安」＝中央値から8%安く
export const HIGH_MARKUP = 0.1; // 「高値」＝中央値から10%高く
// 損益分岐の重量に乗せる安全係数。重量はAI推定で誤差があり、実物が重いと実EMS送料が想定を超え赤字化する。
// 損益分岐(floor)側だけ重めに見積もって必ず黒字側に倒す（買い手への送料表示は実費の現実値のまま＝過大請求しない）。
export const WEIGHT_SAFETY_FLOOR = Number(process.env.LANDED_WEIGHT_SAFETY_FLOOR) || 1.1;

// 価格 priceUsd で売るときの損益分岐(USD)＝その価格の着地コスト(関税/EMSは価格依存)で評価。
// ⚠️重量は安全係数(WEIGHT_SAFETY_FLOOR)で重めに見積もる＝AI重量の過小評価による送料負けを防ぐ。
export function floorAtPriceUsd(costJpy: number, weightG: number, priceUsd: number): number {
  const landed = landedCostForWeight(Math.round(weightG * WEIGHT_SAFETY_FLOOR), Math.max(0, priceUsd));
  return (costJpy + FEE_FIXED_JPY + landed.subtractJpy) / (1 - FEE_RATE) / USD_JPY;
}

// 自己整合の損益分岐(±0)USD＝不動点反復。原価から始めて、その価格の着地コストで再計算…を収束させる。
// しきい値($100/$120/2kg)で着地コストが跳ねても、収束先は「自分の価格で評価した floor」＝矛盾しない。
export function breakevenUsd(costJpy: number, weightG: number): number {
  if (!(costJpy > 0) || !(weightG > 0)) return 0;
  let v = costJpy / USD_JPY;
  for (let i = 0; i < 6; i++) v = floorAtPriceUsd(costJpy, weightG, v);
  return Math.ceil(v * 100) / 100; // 安全側に切り上げ(1セント未満の丸めで赤字にしない)
}

// 候補価格を「絶対に赤字にならない」最小安全価格へ引き上げる。
// be(損益分岐)未満は be へ。さらに、その価格自身の floor を割っていれば(しきい値の損失帯)その floor まで押し上げる。
export function safePriceUsd(candidateUsd: number, costJpy: number, weightG: number, be: number): number {
  let p = Math.max(candidateUsd, be);
  for (let i = 0; i < 4; i++) {
    const f = floorAtPriceUsd(costJpy, weightG, p);
    if (p < f - 1e-9) p = f;
    else break;
  }
  return Math.ceil(p * 100) / 100;
}

export interface PriceModel {
  breakevenUsd: number; // ±0出品（損益分岐・アカウント育成）
  lowUsd: number; // 最安（中央値−8%、ただし損益分岐は割らない）
  medianUsd: number; // 中央値（eBay想定売値）
  highUsd: number; // 高値（中央値+10%）
}

// SSOT本体。costJpy=仕入れ原価(国内送料込み)・weightG=梱包重量・marketMedianUsd=eBay想定売値(中央値USD)。
// 原価/重量/相場が無ければ 0 を返す（呼び出し側でボタン無効化）。
export function computePriceModel(costJpy: number, weightG: number, marketMedianUsd: number): PriceModel {
  if (!(costJpy > 0) || !(weightG > 0)) return { breakevenUsd: 0, lowUsd: 0, medianUsd: 0, highUsd: 0 };
  const be = breakevenUsd(costJpy, weightG);
  const m = marketMedianUsd > 0 ? marketMedianUsd : 0;
  if (!(m > 0)) return { breakevenUsd: be, lowUsd: 0, medianUsd: 0, highUsd: 0 };
  return {
    breakevenUsd: be,
    lowUsd: safePriceUsd(m * (1 - FAST_DISCOUNT), costJpy, weightG, be),
    medianUsd: safePriceUsd(m, costJpy, weightG, be),
    highUsd: safePriceUsd(m * (1 + HIGH_MARKUP), costJpy, weightG, be),
  };
}
