// 国際送料＋米国輸入関税(DDP前払い)の「着地コスト」概算。サーバー専用の純ロジック。
// eBay最安ベースの利益／損益分岐から、これを差し引いて“本当に黒字か”を判定する。
//
// なぜ serve-time 計算か：
//  ・商品に重量データが無い（仕入れ元からも安定取得不可）→ カテゴリ別の概算重量(梱包込み・安全側に多め)で代替。
//  ・米国の制度が流動的（2025/8デミニミス撤廃・$100超はDDP前払い・関税率は係争中で2026/7失効予定）
//    → 税率・手数料・為替・買い手送料負担を env / 定数で外出しし、再ビルド無しで即追従できるようにする。
//
// 確証済み一次情報（日本郵便・米国宛・2025-2026）:
//  ・国際エアパケット(追跡のみ・補償なし・〜2kg)：100g¥1,200、以降100gごと+¥210（500g¥2,040 / 1kg¥3,090 / 2kg¥5,190）
//  ・EMS(追跡+2万円補償・最低¥3,900)：500g¥3,900 / 1kg¥5,300 / 2kg¥7,900
//  ・米国関税：$100以下=前払い不要 / $100超〜$800=Zonosで関税前払い(DDP)必須 / $800超=処理不可
//    郵便ルートの暫定税率は概ね一律10%＋Zonos手数料 約$1.50/件（いずれも未確定＝envで上書き可）

// --- 着地コストの計算式は landedCostCore.mjs に一本化（SSOT）---
// app(ここ) と GitHub Actions(refresh.mjs) が同じ式・同じ env ノブ(LANDED_*)を共有する。
// 以前は landedCost.ts と refresh.mjs に二重在し、refresh 側はハードコードで env を無視していた（ドリフトの罠）。
import {
  estimateWeightG,
  intlShippingJpy,
  usDutyJpy,
  USD_JPY,
  EBAY_FEE_RATE,
  DUTY_FREE_USD,
  recommendShippingTier,
  SHIP_TIER_USD,
  shipShortfallJpy,
} from "./landedCostCore.mjs";
// 既存の呼び出し元（landedCost.ts から import している箇所）を維持するため再エクスポート。
// USD_JPY/サイズ別定額/推奨サイズも SSOT(landedCostCore) からの再エクスポートに統一＝各所のハードコードを廃止。
export { estimateWeightG, intlShippingJpy, usDutyJpy, USD_JPY, recommendShippingTier, SHIP_TIER_USD };

export type ShippingMethod = "airpacket" | "ems";

export interface LandedCost {
  weightG: number;
  shippingJpy: number; // 国際送料の実費(目安)
  shippingMethod: ShippingMethod;
  shippingFeeJpy: number; // 購入者が払う送料にかかるeBay手数料(=出品者負担。送料自体は購入者負担)
  dutyJpy: number; // 米国関税(DDP前払い・出品者立替)
  shortfallJpy: number; // 定額送料(最適サイズの請求額)では実費に届かない不足(=出品者負担)。0なら請求が実費をカバー
  subtractJpy: number; // 利益/損益分岐から差し引く合計(= 送料へのeBay手数料 + 関税 + 送料不足)
  needsDutyPrepay: boolean; // $100超＝Zonos前払い＋指定郵便局が必要
}

// 着地コスト一式（重量を直接指定）。ユーザーが「重さ(任意)」を入力したらこちらで再計算する。
export function landedCostForWeight(weightG: number, valueUsd: number): LandedCost {
  const ship = intlShippingJpy(weightG, valueUsd);
  const dutyJpy = usDutyJpy(valueUsd);
  // 送料そのものは購入者負担(配送ポリシーで請求)。出品者がかぶるのは(1)その送料にかかるeBay手数料
  // (2)$100超の関税(前払い) (3)定額送料では実費に届かない不足(shortfall)。重量帯別の定額が実費に届けば(3)は0。
  const shippingFeeJpy = Math.round(ship.jpy * EBAY_FEE_RATE);
  const shortfallJpy = shipShortfallJpy(weightG, valueUsd);
  return {
    weightG,
    shippingJpy: ship.jpy,
    shippingMethod: ship.method,
    shippingFeeJpy,
    dutyJpy,
    shortfallJpy,
    subtractJpy: shippingFeeJpy + dutyJpy + shortfallJpy,
    needsDutyPrepay: valueUsd > DUTY_FREE_USD,
  };
}

// 着地コスト一式（カテゴリから重量を概算）。valueUsd は eBay想定売価(申告価格)。
export function landedCost(category: string | undefined, valueUsd: number): LandedCost {
  return landedCostForWeight(estimateWeightG(category), valueUsd);
}

// ====== 配送ポリシー(small/medium/large)の選択 ======
// recommendShippingTier は SSOT(landedCostCore) に移動＝利益計算の送料不足見積りと同一ロジックを共用。
// ここでは pickShippingPolicyId 用に型だけ保持し、関数本体は core からの再エクスポート(上)を使う。
export type ShippingTier = "small" | "medium" | "large";

// 配送ポリシー一覧(名前に small/medium/large を含む)から、tier に合うポリシーIDを選ぶ。
// 該当が無ければ medium→先頭にフォールバック。
export function pickShippingPolicyId(
  policies: { fulfillmentPolicyId: string; name: string }[] | undefined,
  tier: ShippingTier
): string | undefined {
  if (!policies?.length) return undefined;
  const re = tier === "small" ? /small/i : tier === "large" ? /large/i : /medium/i;
  return (
    policies.find((p) => re.test(p.name)) ??
    policies.find((p) => /medium/i.test(p.name)) ??
    policies[0]
  )?.fulfillmentPolicyId;
}
