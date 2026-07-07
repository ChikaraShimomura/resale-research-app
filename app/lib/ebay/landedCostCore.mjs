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
// eBay手数料(2026・日本セラーの実態)。従来は一律13.25%で「国際手数料/Payoneer為替/時計15%」を計上せず利益を過大表示していた。
// ユーザー指示2026-07-05(A=実態に正確化)：落札手数料(カテゴリ別FVF)＋海外決済手数料(1.35%)＋Payoneer為替(~2%)を合算した「実効手数料率」にする。
// ※合算(fvf+intl+fx)は厳密な合成 (1-fvf-intl)(1-fx) の近似だが、無視する差の項(≒fvf×fx≈0.3%)は手数料を僅かに高めに見積る＝安全側(赤字を出さない)。
// ⚠️クライアント(EbayListingModal/ProductCard)もこの率を import する。LANDED_EBAY_* は NEXT_PUBLIC_ でないためクライアントでは
//   undefined→既定値に解決される（＝サーバーで env 上書きしてもクライアントは既定のまま食い違う）。既定運用ではサーバーもクライアントも既定値で一致し問題ない。
//   料率を変える時は既定値(下記の ?? の値)自体を変えるか、モーダルはサーバー算出の floorUsd を正とし publish が最終ゲート(赤字はサーバーで必ず弾く)であることに留意。
export const EBAY_FVF_DEFAULT   = Number(process.env.LANDED_EBAY_FVF ?? 0.136);        // 多くのカテゴリの落札手数料(2026標準13.6%)
export const EBAY_FVF_WATCH     = Number(process.env.LANDED_EBAY_FVF_WATCH ?? 0.15);   // 時計/ジュエリー/貴金属は15%
export const EBAY_INTL_FEE_RATE = Number(process.env.LANDED_EBAY_INTL_FEE ?? 0.0135);  // 海外決済手数料(小規模セラー基準1.35%・大口はボリューム割で下がる)
export const EBAY_FX_RATE       = Number(process.env.LANDED_EBAY_FX ?? 0.02);          // Payoneer USD→JPY 為替コスト(~2%)
export const EBAY_FEE_FIXED_USD = Number(process.env.LANDED_EBAY_FEE_FIXED_USD ?? 0.40); // 注文ごと固定手数料($10超=$0.40)
// カテゴリ(日本語ジャンル文字列)→実効手数料率。時計/ジュエリーだけ高FVF、他は標準。国際手数料＋為替は全カテゴリ共通で加算。
export function ebayFeeRate(category) {
  const c = String(category ?? "");
  const fvf = /腕時計|時計|ジュエリー|貴金属|watch|jewel/i.test(c) ? EBAY_FVF_WATCH : EBAY_FVF_DEFAULT;
  return fvf + EBAY_INTL_FEE_RATE + EBAY_FX_RATE;
}
// 注文ごと固定手数料(円)。$0.40 × 為替。
export function ebayFeeFixedJpy() { return Math.round(EBAY_FEE_FIXED_USD * USD_JPY); }
// 後方互換：EBAY_FEE_RATE = カテゴリ不明時の実効率(国際手数料/為替込み)。この定数を import している既存経路(landedCost/profitCore等)が自動で実態化される。
export const EBAY_FEE_RATE = ebayFeeRate(null);
export const WEIGHT_SAFETY = Number(process.env.LANDED_WEIGHT_SAFETY) || 1.15;
// 配送サイズ別の既定送料(USD・買い手への請求額)。EbayPolicySetup の既定とここをSSOTで一致させる(env上書き可)。
// 利益計算が「請求でどこまで実費を相殺できるか」を見積もるのにも使う(定額では届かない不足を正直に引くため)。
export const SHIP_TIER_USD = {
  small: Number(process.env.LANDED_SHIP_SMALL_USD ?? 14),
  medium: Number(process.env.LANDED_SHIP_MEDIUM_USD ?? 25),
  large: Number(process.env.LANDED_SHIP_LARGE_USD ?? 45),
};

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
  バッグ: 1200, // ブランドバッグ(革・付属品・箱/保存袋込みで重め・安全側)。出品時に実重量で補正。
  ジュエリー: 300, // 指輪/ネックレス等は軽いが箱/緩衝材込み。ジュエリーはeBay手数料15%(ebayFeeRate)。
  カメラ: 1500,
  オーディオ: 1800, // アンプ/ターンテーブルは重い。ヘッドホン等は出品時のAI実重量で軽くなる(概算は安全側に重め)。
  楽器: 1200,       // エフェクター主体だが本体・ケースで重め。出品時に実重量で補正。
  工具: 1800,       // 電動工具(本体)。出品時に実重量で補正。
  アニメ: 500,
  古着: 500, // 衣類(梱包込み・軽め)
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

// 推定重量＋申告価格から配送サイズ(small/medium/large)を選ぶ。出品ポリシー選択と利益計算で共用(SSOT)。
// 高額(EMS必須)は重量に関わらず大に寄せる(補償付き=送料が高いため)。
/** @returns {"small"|"medium"|"large"} */
export function recommendShippingTier(weightG, valueUsd) {
  if (valueUsd >= EMS_VALUE_USD) return "large"; // $120超=EMS(補償付き・高送料)前提で大サイズへ
  if (weightG <= 500) return "small";   // エアパケット〜¥2,040
  if (weightG <= 1200) return "medium"; // エアパケット〜¥3,500前後
  return "large";                       // 〜2kg / EMS帯
}

// 定額送料(その品の最適サイズの請求額)では実費に届かない不足分(円・出品者負担)。0以上。
// 定額3段では重量帯/EMSの実費を完全には捉えられない(特に大=EMS高額重量物)。この不足を利益/損益分岐から
// 正直に差し引くことで、表示利益が実態とズレない(「請求=実費で相殺」前提の穴を塞ぐ)。
export function shipShortfallJpy(weightG, valueUsd) {
  const realJpy = intlShippingJpy(weightG, valueUsd).jpy;
  const tier = recommendShippingTier(weightG, valueUsd);
  const chargeJpy = (SHIP_TIER_USD[tier] || 0) * USD_JPY;
  return Math.max(0, Math.round(realJpy - chargeJpy));
}

// 利益/損益分岐から差し引く合計(= 送料にかかるeBay手数料 + 米国関税 + 定額送料で届かない不足)。category から重量を概算。
export function landedSubtractJpy(category, valueUsd) {
  const weightG = estimateWeightG(category);
  const ship = intlShippingJpy(weightG, valueUsd);
  // 送料にもeBay手数料(FVFは商品+送料の合計にかかる)＋国際手数料＋為替＝実効率をカテゴリ別で適用。
  return Math.round(ship.jpy * ebayFeeRate(category)) + usDutyJpy(valueUsd) + shipShortfallJpy(weightG, valueUsd);
}
