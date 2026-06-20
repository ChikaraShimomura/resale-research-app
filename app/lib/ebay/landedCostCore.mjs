// 着地コスト計算の単一の真実(SSOT)。app(landedCost.ts)と GitHub Actions(refresh.mjs)の両方がここを参照する。
// 以前は landedCost.ts と refresh.mjs に同じ式が二重在していた（しかも refresh 側はハードコードで env 上書きを無視＝
// LANDED_* を設定すると両者が食い違う潜在バグ）。ここに一本化し、両方とも env 駆動で揃える。
// 純JS(ESM)＝node script(refresh.mjs)からも、Next.js(.ts/allowJs)からも import できる。

// --- 可変ノブ（制度変更・為替に追従するため env で上書き可能） ---
export const USD_JPY = Number(process.env.LANDED_USD_JPY) || 155;
export const US_DUTY_RATE = Number(process.env.LANDED_US_DUTY_RATE ?? 0.1);
export const ZONOS_FEE_USD = Number(process.env.LANDED_ZONOS_FEE_USD ?? 1.5);
export const DUTY_FREE_USD = Number(process.env.LANDED_DUTY_FREE_USD ?? 100);
export const EMS_VALUE_USD = Number(process.env.LANDED_EMS_VALUE_USD ?? 120);
export const EBAY_FEE_RATE = Number(process.env.LANDED_EBAY_FEE_RATE ?? 0.1325);
export const WEIGHT_SAFETY = Number(process.env.LANDED_WEIGHT_SAFETY) || 1.15;

// カテゴリ別の概算重量(g・梱包込み・安全側に多め)。語彙は refresh.mjs の guessCategory / domesticShipping と揃える。
export const WEIGHT_G = {
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

export function estimateWeightG(category) {
  const base = WEIGHT_G[category ?? "その他"] ?? 700;
  return Math.round(base * WEIGHT_SAFETY);
}

// 推定重量＋申告価格(USD)から日本郵便の実費(円)を見積もる。高額/重量超はEMS、それ以外はエアパケット。
/** @returns {{ jpy: number, method: "airpacket" | "ems" }} */
export function intlShippingJpy(weightG, valueUsd) {
  const useEms = valueUsd >= EMS_VALUE_USD || weightG > 2000;
  if (useEms) {
    let jpy;
    if (weightG <= 500) jpy = 3900;
    else if (weightG <= 1000) jpy = 5300;
    else if (weightG <= 1500) jpy = 6600;
    else if (weightG <= 2000) jpy = 7900;
    else jpy = 7900 + Math.ceil((weightG - 2000) / 500) * 1400;
    return { jpy, method: "ems" };
  }
  const w = Math.min(2000, Math.max(100, weightG));
  const steps = Math.ceil((w - 100) / 100); // 100g起点の100g刻み
  return { jpy: 1200 + steps * 210, method: "airpacket" };
}

// 米国輸入関税(DDP前払い)の出品者負担(円)。$100以下は前払い不要＝0。
export function usDutyJpy(valueUsd) {
  if (valueUsd <= DUTY_FREE_USD) return 0;
  return Math.round((valueUsd * US_DUTY_RATE + ZONOS_FEE_USD) * USD_JPY);
}

// 利益/損益分岐から差し引く合計(= 送料にかかるeBay手数料 + 米国関税)。category から重量を概算。
export function landedSubtractJpy(category, valueUsd) {
  const ship = intlShippingJpy(estimateWeightG(category), valueUsd);
  return Math.round(ship.jpy * EBAY_FEE_RATE) + usDutyJpy(valueUsd);
}
