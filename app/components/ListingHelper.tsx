"use client";
import { useState, useEffect } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { Check, ExternalLink } from "lucide-react";
import EbayListingModal from "./EbayListingModal";
import { track } from "../lib/analytics";

interface Props {
  product: ProfitProduct | Product;
  // 設定完了→出品画面へ戻ってきた等で、最初から開く。
  autoOpen?: boolean;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, autoOpen = false }: Props) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(false);

  // 設定完了から戻ってきた場合は出品画面を開く。
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  // 出品済みは端末に記録されている。再訪時もボタンを非アクティブにする。
  useEffect(() => {
    try {
      if (localStorage.getItem(`listed_${product.id}`) === "1") setListed(true);
    } catch {
      /* noop */
    }
  }, [product.id]);

  // 出品成功 → 端末に「出品済み」を記録し、ボタンを非アクティブに。出品者数の計上はサーバー側。
  const handleListed = () => {
    try {
      localStorage.setItem(`listed_${product.id}`, "1");
    } catch {
      /* noop */
    }
    setListed(true);
  };

  // 誰でも押せる（楽天仕入れの有無は出品ボタン押下時にモーダル内でチェックする）。出品済みのみ非アクティブ。
  const onClick = () => {
    if (listed) return;
    track("ebay_list_open", { product_id: product.id });
    setOpen(true);
  };

  return (
    <div className="flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-disabled={listed}
        disabled={listed}
        className={`
          w-full inline-flex items-center justify-center gap-1 h-11 whitespace-nowrap
          text-[13px] font-bold rounded-xl transition-all
          ${listed
            ? "bg-gray-100 text-gray-400 border border-[#A98B5C]/35 cursor-default"
            : "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
          }
        `}
      >
        {listed ? <Check size={14} /> : <ExternalLink size={14} />}
        {listed ? "出品済み" : "eBay自動出品"}
      </button>

      {open && isProfitProduct(product) && (
        <EbayListingModal product={product} onClose={() => setOpen(false)} onListed={handleListed} />
      )}
    </div>
  );
}
