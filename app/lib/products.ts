import { ProfitProduct } from "./profitFilter";

export async function fetchProducts(): Promise<{ products: ProfitProduct[]; lastUpdated: string | null }> {
  try {
    const res = await fetch("/api/products", { cache: "no-store" });
    if (!res.ok) return { products: [], lastUpdated: null };
    return await res.json();
  } catch {
    return { products: [], lastUpdated: null };
  }
}
