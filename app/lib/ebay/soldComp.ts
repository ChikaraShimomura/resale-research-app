import { ProfitProduct } from "../profitFilter";
import { calcProfit } from "./profitCore.mjs";
import { kvReadOnly } from "../kv";

// 直近落札(ebay_soldprice:{id}・ebaySoldWorker が住宅IPで収集)が新鮮なら、その中央値を eBay 相場として
// 利益を再判定する＝「eBay直近落札 × 楽天」。落札データが無い/古い商品は従来の現在出品相場(realAvgPrice)のまま。
//
// コスト最小：Anthropic も再マッチも走らせない。配信のたびに ebay_soldprice をまとめ読み(pipeline)して
// 算術で再計算するだけ。ワーカーが止まれば各値は TTL で自然失効→自動で現在出品相場へフォールバック。

const FRESH_MS = (Number(process.env.EBAY_SOLDPRICE_FRESH_DAYS) || 14) * 86400000;

interface SoldRec {
  median?: number;
  medianUsd?: number;
  count?: number;
  windowDays?: number;
  soldBased?: boolean;
  at?: string;
}

function parseRec(v: unknown): SoldRec | null {
  let r: unknown = v;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { return null; } }
  return r && typeof r === "object" ? (r as SoldRec) : null;
}

// 落札中央値で realAvgPrice / realProfit を上書きした“コピー”を返す（元配列は不変）。
// realAvgPrice も落札中央値へ置換することで、後段の applyDisplayProfit が着地コストを実売価ベースで計算する。
export async function applySoldComp(products: ProfitProduct[]): Promise<ProfitProduct[]> {
  if (!Array.isArray(products) || products.length === 0) return products ?? [];
  let recs: unknown[] = [];
  try {
    const pipe = kvReadOnly.pipeline();
    products.forEach((p) => pipe.get(`ebay_soldprice:${p.id}`));
    recs = (await pipe.exec()) as unknown[];
  } catch {
    return products; // KV障害時は据え置き（フェイルオープン＝一覧を壊さない）
  }
  const now = Date.now();
  return products.map((p, i) => {
    const r = parseRec(recs?.[i]);
    if (!r) return p;
    const median = Number(r.median) || 0;
    const at = r.at ? Date.parse(r.at) : 0;
    if (!(median > 0) || !at || now - at > FRESH_MS) return p; // 無効/古い→従来の現在出品相場のまま
    const point = p.source?.pointAmount ?? 0;
    const ship = p.source?.shippingJpy ?? 0;
    const { profit, profitRate } = calcProfit(p.source?.price ?? 0, median, point, ship);
    return {
      ...p,
      realAvgPrice: median,        // 相場＝直近落札中央値（表示/着地コスト/利益すべて実売価ベースへ）
      realMedianPrice: median,
      realProfit: profit,          // 落札ベースの粗利（applyDisplayProfit が現金純利益へ）
      realProfitRate: profitRate,
      soldBased: true,
      soldCount30d: Number(r.count) || 0,
      soldWindowDays: Number(r.windowDays) || 30,
    };
  });
}
