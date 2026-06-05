import { Product } from "../types";

export async function searchRakuten(keyword: string): Promise<Product[]> {
  try {
    const res = await fetch(`/api/rakuten?keyword=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.products ?? [];
  } catch {
    return [];
  }
}
