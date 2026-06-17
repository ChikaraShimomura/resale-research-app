import { SortOrder } from "../components/SortSelect";

// 並び替え・絞り込みの設定を端末に保存し、ページを移動しても維持する（毎回初期化されないように）。
const SORT_KEY = "rr_sort";
const HIDESOLD_KEY = "rr_hidesold";
const VALID_SORTS: SortOrder[] = ["recommended", "default", "rate", "profit", "cheap", "demand", "rival"];

export function readSort(): SortOrder {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v && (VALID_SORTS as string[]).includes(v)) return v as SortOrder;
  } catch {
    /* noop */
  }
  return "recommended";
}
export function writeSort(v: SortOrder): void {
  try { localStorage.setItem(SORT_KEY, v); } catch { /* noop */ }
}
export function readHideSold(): boolean {
  try { return localStorage.getItem(HIDESOLD_KEY) === "1"; } catch { return false; }
}
export function writeHideSold(v: boolean): void {
  try { localStorage.setItem(HIDESOLD_KEY, v ? "1" : "0"); } catch { /* noop */ }
}
