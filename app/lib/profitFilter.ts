import { Product } from "../types";

const MERCARI_SHIPPING = 500;
const MIN_PROFIT = 500;
const BATCH_SIZE = 5; // 同時リクエスト数

export interface ProfitProduct extends Product {
  realAvgPrice: number;
  realProfit: number;
  realProfitRate: number;
  realCount: number;
}

async function checkProfit(product: Product): Promise<ProfitProduct | null> {
  try {
    const res = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rakutenTitle: product.title,
        rakutenImageUrl: product.imageUrl,
        rakutenPrice: product.source.price,
      }),
    });
    const d = await res.json();
    if (!d.matched || !d.avgPrice) return null;

    const avg = d.avgPrice as number;
    const fee = Math.round(avg * 0.1);
    const profit = avg - product.source.price - fee - MERCARI_SHIPPING;
    if (profit < MIN_PROFIT) return null;

    const profitRate = Math.round((profit / product.source.price) * 100);
    return { ...product, realAvgPrice: avg, realProfit: profit, realProfitRate: profitRate, realCount: d.count ?? 0 };
  } catch {
    return null;
  }
}

// バッチ処理で利益商品だけ返す
export async function filterProfitable(
  products: Product[],
  onProgress?: (found: ProfitProduct[], checked: number, total: number) => void
): Promise<ProfitProduct[]> {
  const results: ProfitProduct[] = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const checked = await Promise.all(batch.map(checkProfit));
    const profitable = checked.filter((p): p is ProfitProduct => p !== null);
    results.push(...profitable);
    onProgress?.(results, Math.min(i + BATCH_SIZE, products.length), products.length);
  }

  return results;
}
