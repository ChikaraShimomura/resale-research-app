import { SortOrder } from "../components/SortSelect";

// 並び替え・絞り込みの設定を端末に保存し、ページを移動しても維持する（毎回初期化されないように）。
const SORT_KEY = "rr_sort";
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

// 出品の既定値（端末に保存し、出品モーダルの初期値に使う）。毎回同じ設定を選び直さなくて済むように。
// ※ 商品の状態(New/Used)はタイトルから自動判定する方が正確なので既定値には含めない。
const LISTING_DEFAULTS_KEY = "rr_listing_defaults";
export interface ListingDefaults {
  bestOffer: boolean; // 値下げ交渉(Best Offer)を受け付けるか
  handlingDays: number; // 発送までの日数（落札後）
}
export function readListingDefaults(): ListingDefaults {
  try {
    const raw = localStorage.getItem(LISTING_DEFAULTS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        bestOffer: typeof o.bestOffer === "boolean" ? o.bestOffer : true,
        handlingDays: Number.isFinite(o.handlingDays) && o.handlingDays > 0 ? Math.min(30, Math.floor(o.handlingDays)) : 7,
      };
    }
  } catch {
    /* noop */
  }
  return { bestOffer: true, handlingDays: 7 };
}
export function writeListingDefaults(d: ListingDefaults): void {
  try { localStorage.setItem(LISTING_DEFAULTS_KEY, JSON.stringify(d)); } catch { /* noop */ }
}
