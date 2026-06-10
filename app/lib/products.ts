import { ProfitProduct } from "./profitFilter";

export interface ProductsResponse {
  products: ProfitProduct[];
  lastUpdated: string | null;
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
