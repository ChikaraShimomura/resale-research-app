// 国際送料＋米国輸入関税(DDP前払い)の「着地コスト」概算。サーバー専用の純ロジック。
// eBay最安ベースの利益／損益分岐から、これを差し引いて“本当に黒字か”を判定する。
//
// なぜ serve-time 計算か：
//  ・商品に重量データが無い（楽天APIも安定取得不可）→ カテゴリ別の概算重量(梱包込み・安全側に多め)で代替。
//  ・米国の制度が流動的（2025/8デミニミス撤廃・$100超はDDP前払い・関税率は係争中で2026/7失効予定）
//    → 税率・手数料・為替・買い手送料負担を env / 定数で外出しし、再ビルド無しで即追従できるようにする。
//
// 確証済み一次情報（日本郵便・米国宛・2025-2026）:
//  ・国際エアパケット(追跡のみ・補償なし・〜2kg)：100g¥1,200、以降100gごと+¥210（500g¥2,040 / 1kg¥3,090 / 2kg¥5,190）
//  ・EMS(追跡+2万円補償・最低¥3,900)：500g¥3,900 / 1kg¥5,300 / 2kg¥7,900
//  ・米国関税：$100以下=前払い不要 / $100超〜$800=Zonosで関税前払い(DDP)必須 / $800超=処理不可
//    郵便ルートの暫定税率は概ね一律10%＋Zonos手数料 約$1.50/件（いずれも未確定＝envで上書き可）

// --- 可変ノブ（制度変更・為替に追従するため env で上書き可能） ---
const USD_JPY = Number(process.env.LANDED_USD_JPY) || 155; // refresh.mjs / stats.ts と既定一致
const US_DUTY_RATE = Number(process.env.LANDED_US_DUTY_RATE ?? 0.1); // 郵便ルート暫定の一律関税(係争中)
const ZONOS_FEE_USD = Number(process.env.LANDED_ZONOS_FEE_USD ?? 1.5); // DDP前払いの処理手数料/件(概算)
const DUTY_FREE_USD = Number(process.env.LANDED_DUTY_FREE_USD ?? 100); // これ以下は前払い不要(帯・要窓口確認)
const EMS_VALUE_USD = Number(process.env.LANDED_EMS_VALUE_USD ?? 120); // これ以上は補償付きEMSを前提に見積もる
// 買い手がeBayの送料として負担してくれる額の目安(現状の固定送料≒$12)。実費との差額(shortfall)だけが出品者負担。
const BUYER_SHIP_CREDIT_JPY = Number(process.env.LANDED_BUYER_SHIP_CREDIT_JPY ?? 1860);

// カテゴリ別の概算重量(g・梱包込み・安全側に多め)。語彙は refresh.mjs の guessCategory / domesticShipping と揃える。
// 過小だと赤字を見逃すので、迷ったら重め。代表商品の実測で随時較正する前提。
const WEIGHT_G: Record<string, number> = {
  トレカ: 150,
  コスメ: 350,
  ゲーム: 250,
  ゲーム機: 1500,
  フィギュア: 800,
  ガンプラ: 900,
  LEGO: 1500,
  腕時計: 500,
  カメラ: 1500,
  アニメ: 500,
  おもちゃ: 700,
  その他: 700,
};

export function estimateWeightG(category?: string): number {
  return WEIGHT_G[category ?? "その他"] ?? 700;
}

export type ShippingMethod = "airpacket" | "ems";

// 推定重量＋申告価格(USD)から日本郵便の実費(円)を見積もる。高額/重量超はEMS、それ以外はエアパケット。
export function intlShippingJpy(weightG: number, valueUsd: number): { jpy: number; method: ShippingMethod } {
  const useEms = valueUsd >= EMS_VALUE_USD || weightG > 2000; // 高額は補償付きEMS推奨／2kg超はエアパケ不可
  if (useEms) {
    // EMS第4地帯：500g¥3,900 を起点に、超過500gごと+¥1,400で近似（確証 1kg¥5,300/2kg¥7,900 にやや安全側で一致）。
    const over = Math.max(0, weightG - 500);
    const jpy = 3900 + Math.ceil(over / 500) * 1400;
    return { jpy: Math.max(3900, jpy), method: "ems" };
  }
  const w = Math.min(2000, Math.max(100, weightG));
  const steps = Math.ceil((w - 100) / 100); // 100g起点の100g刻み
  return { jpy: 1200 + steps * 210, method: "airpacket" };
}

// 米国輸入関税(DDP前払い)の出品者負担(円)。$100以下は前払い不要＝0。
export function usDutyJpy(valueUsd: number): number {
  if (valueUsd <= DUTY_FREE_USD) return 0;
  return Math.round((valueUsd * US_DUTY_RATE + ZONOS_FEE_USD) * USD_JPY);
}

export interface LandedCost {
  weightG: number;
  shippingJpy: number; // 国際送料の実費(目安)
  shippingMethod: ShippingMethod;
  shippingShortfallJpy: number; // 実費 − 買い手送料負担(=出品者がかぶる分)
  dutyJpy: number; // 米国関税(DDP前払い・出品者立替)
  subtractJpy: number; // 利益/損益分岐から差し引く合計(= shortfall + duty)
  needsDutyPrepay: boolean; // $100超＝Zonos前払い＋指定郵便局が必要
}

// 着地コスト一式（重量を直接指定）。ユーザーが「重さ(任意)」を入力したらこちらで再計算する。
export function landedCostForWeight(weightG: number, valueUsd: number): LandedCost {
  const ship = intlShippingJpy(weightG, valueUsd);
  const dutyJpy = usDutyJpy(valueUsd);
  const shippingShortfallJpy = Math.max(0, ship.jpy - BUYER_SHIP_CREDIT_JPY);
  return {
    weightG,
    shippingJpy: ship.jpy,
    shippingMethod: ship.method,
    shippingShortfallJpy,
    dutyJpy,
    subtractJpy: shippingShortfallJpy + dutyJpy,
    needsDutyPrepay: valueUsd > DUTY_FREE_USD,
  };
}

// 着地コスト一式（カテゴリから重量を概算）。valueUsd は eBay想定売価(申告価格)。
export function landedCost(category: string | undefined, valueUsd: number): LandedCost {
  return landedCostForWeight(estimateWeightG(category), valueUsd);
}
