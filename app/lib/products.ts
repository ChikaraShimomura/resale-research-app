import { ProfitProduct } from "./profitFilter";

export interface ProductsResponse {
  products: ProfitProduct[];
  lastUpdated: string | null;
  needsPlan?: boolean; // 未購読(free)＝利益商品は配信されない。呼び出し側で /pricing へ誘導する。
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
