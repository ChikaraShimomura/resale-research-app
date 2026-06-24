import { ProfitProduct } from "./profitFilter";

export interface ProductsResponse {
  products: ProfitProduct[];
  lastUpdated: string | null;
  needsPlan?: boolean; // 未購読(free)＝利益商品は配信されない（旧・ハードゲート用）。
  masked?: boolean;    // 未購読(free)＝マスク版(タイトル/画像/利益率のみ)を配信中。呼び出し側はリダイレクトせずティーザー表示＋プラン導線を出す。
}

export async function fetchProducts(): Promise<ProductsResponse> {
  try {
    const res = await fetch("/api/products", { cache: "no-store" });
    if (!res.ok) return { products: [], lastUpdated: null };
    return await res.json();
  } catch {
    return { products: [], lastUpdated: null };
  }
}
