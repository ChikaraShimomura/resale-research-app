"use client";
import { useState } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { Check, ExternalLink } from "lucide-react";
import EbayListingModal from "./EbayListingModal";

interface Props {
  product: ProfitProduct | Product;
  onCountChange: (count: number) => void;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, onCountChange }: Props) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(false);

  // 出品成功 → ライバル数(出品カウント)を加算し、ボタンを「出品済み」に。
  const handleListed = () => {
    setListed(true);
    fetch(`/api/listing-count/${product.id}`, { method: "POST", keepalive: true })
      .then((r) => r.json())
      .then((d) => onCountChange(d.count))
      .catch(() => {});
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`
          flex-1 inline-flex items-center justify-center gap-1 h-11 whitespace-nowrap
          text-[13px] font-bold rounded-xl transition-all
          ${listed
            ? "bg-emerald-500 text-white"
            : "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
          }
        `}
      >
        {listed ? <Check size={14} /> : <ExternalLink size={14} />}
        {listed ? "出品済み！" : "eBay簡単出品"}
      </button>

      {open && isProfitProduct(product) && (
        <EbayListingModal product={product} onClose={() => setOpen(false)} onListed={handleListed} />
      )}
    </>
  );
}
