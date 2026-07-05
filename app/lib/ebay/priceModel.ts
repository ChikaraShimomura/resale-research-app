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
import { landedCostForWeight, USD_JPY, intlShippingJpy, usDutyJpy } from "./landedCost";
import { ebayFeeRate, ebayFeeFixedJpy } from "./landedCostCore.mjs";

// eBay実効手数料(2026・カテゴリ別FVF＋海外決済＋為替)は SSOT(landedCostCore.ebayFeeRate)。時計/ジュエリーは15%。
// 総額系の損益分岐/純利益は category を受けて正しい率で計算＝カタログ(build/refine)と食い違わず、時計でも赤字を出さない。
export const FEE_RATE = ebayFeeRate(null); // 後方互換：カテゴリ不明時の実効率(国際手数料/為替込み)。body基準の旧関数が使う。
export const FEE_FIXED_JPY = ebayFeeFixedJpy(); // 注文ごと固定手数料($0.40×為替)
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
  // 収束判定付き反復。$120(EMS)/$100(関税)のしきい値跨ぎは写像が不連続で固定回数だと未収束→±0が自floorを割る不具合があった。
  for (let i = 0; i < 40; i++) {
    const nv = floorAtPriceUsd(costJpy, weightG, v);
    if (Math.abs(nv - v) < 1e-7) { v = nv; break; }
    v = nv;
  }
  v = Math.max(v, floorAtPriceUsd(costJpy, weightG, v)); // 念のため自floorを割らない(不変条件の保証)
  let out = Math.ceil(v * 100) / 100; // 安全側に切り上げ
  const f2 = floorAtPriceUsd(costJpy, weightG, out); // セント切り上げがしきい値を跨いで自floorを再び割らないか確認。
  if (out < f2 - 1e-9) out = Math.ceil(f2 * 100) / 100;
  return out;
}

// 候補価格を「絶対に赤字にならない」最小安全価格へ引き上げる。
// be(損益分岐)未満は be へ。さらに、その価格自身の floor を割っていれば(しきい値の損失帯)その floor まで押し上げる。
export function safePriceUsd(candidateUsd: number, costJpy: number, weightG: number, be: number): number {
  let p = Math.max(candidateUsd, be);
  // 収束判定付き(しきい値跨ぎの遅収束対策)。各段が「その価格自身の損益分岐」を絶対に割らない不変条件を厳密に守る。
  for (let i = 0; i < 24; i++) {
    const f = floorAtPriceUsd(costJpy, weightG, p);
    if (p >= f - 1e-9) break;
    p = f;
  }
  let out = Math.ceil(p * 100) / 100;
  const f2 = floorAtPriceUsd(costJpy, weightG, out); // セント切り上げ後もしきい値直上でfloorを割るなら再度押し上げ。
  if (out < f2 - 1e-9) out = Math.ceil(f2 * 100) / 100;
  return out;
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

// ===== 総額(eBay掲載価格=買い手の支払=申告価値)基準モデル（never-赤字を“真に”保証する版・2026-06-28）=====
// 旧 body 基準は関税$100/EMS$120 を本体価格で判定するため、総額が閾値を跨ぐ品で実際に赤字になる穴があった
// (fold方式の潜在バグ・敵対的レビューで確証)。総額基準では閾値・送料・関税・手数料を全て「実際にeBayに出る総額」で
// 評価＝申告価値/実送料/eBay手数料と一致＝赤字の取りこぼしが無い。free-ship 前提(送料は総額に内包＝売り手が実送料負担)。
// 送料別でも買い手の総額は同じなので総額基準で安全側。検証: 967,010ケース(関税/EMS跨ぎ帯を$0.5刻みで密サンプル)で
// 全段 net≥0 を確認済(scratch proveNeverLossTotal.mjs)。返り値・入力は全て「総額USD」。

// 総額 totalUsd で売る時の純利益(JPY)。weightMul=floor見積りの安全係数(既定 WEIGHT_SAFETY_FLOOR=重め)。実重量評価は 1.0 を渡す。
// category=日本語ジャンル(例"腕時計")。実効手数料率をカテゴリ別に解決＝時計は15%で計算(赤字を出さない)。未指定は既定率。
export function netAtTotalJpy(costJpy: number, weightG: number, totalUsd: number, weightMul: number = WEIGHT_SAFETY_FLOOR, category?: string): number {
  const Tj = Math.round(totalUsd * USD_JPY);
  const fee = Math.round(Tj * ebayFeeRate(category)) + ebayFeeFixedJpy();
  const ship = intlShippingJpy(Math.round(weightG * weightMul), Math.max(0, totalUsd)).jpy; // EMS閾値=総額
  const duty = usDutyJpy(Math.max(0, totalUsd));                                            // 関税閾値=総額
  return Tj - fee - costJpy - ship - duty;
}
// 「現在の総額 atUsd の関税/EMS regime」で損益分岐となる総額(USD)。net=0 を T について解いた式。手数料率はカテゴリ別。
function requiredTotalUsd(costJpy: number, weightG: number, atUsd: number, category?: string): number {
  const ship = intlShippingJpy(Math.round(weightG * WEIGHT_SAFETY_FLOOR), Math.max(0, atUsd)).jpy;
  const duty = usDutyJpy(Math.max(0, atUsd));
  return (costJpy + ebayFeeFixedJpy() + ship + duty) / (1 - ebayFeeRate(category)) / USD_JPY;
}
// 総額の損益分岐(±0)。不動点反復＋閾値跨ぎの安全押し上げ(net≥0 を厳密保証)。手数料率はカテゴリ別(時計15%)。
export function breakevenTotalUsd(costJpy: number, weightG: number, category?: string): number {
  if (!(costJpy > 0) || !(weightG > 0)) return 0;
  let T = costJpy / USD_JPY;
  for (let i = 0; i < 60; i++) { const nt = requiredTotalUsd(costJpy, weightG, T, category); if (Math.abs(nt - T) < 1e-7) { T = nt; break; } T = nt; }
  let out = Math.ceil(Math.max(T, requiredTotalUsd(costJpy, weightG, T, category)) * 100) / 100;
  for (let i = 0; i < 40 && netAtTotalJpy(costJpy, weightG, out, WEIGHT_SAFETY_FLOOR, category) < 0; i++) out = Math.ceil((requiredTotalUsd(costJpy, weightG, out, category) + 0.01) * 100) / 100;
  return out;
}
// 候補総額を「自身の regime で赤字にならない最小総額」へ押し上げる(±0未満は±0へ)。閾値直上の損失帯も net≥0 まで上げる。
function safeTotalUsd(candUsd: number, costJpy: number, weightG: number, be: number, category?: string): number {
  let p = Math.max(candUsd, be);
  for (let i = 0; i < 40 && netAtTotalJpy(costJpy, weightG, p, WEIGHT_SAFETY_FLOOR, category) < 0; i++) p = Math.ceil((requiredTotalUsd(costJpy, weightG, p, category) + 0.01) * 100) / 100;
  let out = Math.ceil(p * 100) / 100;
  for (let i = 0; i < 40 && netAtTotalJpy(costJpy, weightG, out, WEIGHT_SAFETY_FLOOR, category) < 0; i++) out = Math.ceil((requiredTotalUsd(costJpy, weightG, out, category) + 0.01) * 100) / 100;
  return out;
}
// 総額基準の価格モデル。返り値は全て「総額(eBay掲載価格=買い手の支払)」。marketMedianUsd=eBay落札中央値(=商品価格≒総額相当)。category=手数料率(時計15%)用。
export function computePriceModelTotal(costJpy: number, weightG: number, marketMedianUsd: number, category?: string): PriceModel {
  if (!(costJpy > 0) || !(weightG > 0)) return { breakevenUsd: 0, lowUsd: 0, medianUsd: 0, highUsd: 0 };
  const be = breakevenTotalUsd(costJpy, weightG, category);
  const m = marketMedianUsd > 0 ? marketMedianUsd : 0;
  if (!(m > 0)) return { breakevenUsd: be, lowUsd: 0, medianUsd: 0, highUsd: 0 };
  return {
    breakevenUsd: be,
    lowUsd: safeTotalUsd(m * (1 - FAST_DISCOUNT), costJpy, weightG, be, category),
    medianUsd: safeTotalUsd(m, costJpy, weightG, be, category),
    highUsd: safeTotalUsd(m * (1 + HIGH_MARKUP), costJpy, weightG, be, category),
  };
}
