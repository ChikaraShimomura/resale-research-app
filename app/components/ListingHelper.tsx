"use client";
import { Product } from "../types";
import { toEbayListingUrl, toMercariListingUrl } from "../lib/utils";

interface Props {
  product: Product;
  onCountChange: (count: number) => void;
}

export default function ListingHelper({ product, onCountChange }: Props) {
  const titleEn = product.titleEn ?? product.title;
  const descEn = product.descriptionEn ?? `Japanese item: ${product.title}. Ships from Japan via EMS.`;

  const handleClick = async () => {
    try {
      const res = await fetch(`/api/listing-count/${product.id}`, { method: "POST" });
      const data = await res.json();
      onCountChange(data.count);
    } catch {
      // APIエラーはサイレントに無視
    }
  };

  return (
    <div className="flex gap-1.5">
      <a
        href={toEbayListingUrl(titleEn, descEn)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className="flex-1 text-center py-1.5 bg-blue-50 text-blue-600 border border-blue-200 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors"
      >
        eBay出品 ↗
      </a>
      <a
        href={toMercariListingUrl()}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className="flex-1 text-center py-1.5 bg-red-50 text-red-500 border border-red-200 text-xs font-medium rounded-lg hover:bg-red-100 transition-colors"
      >
        メルカリ出品 ↗
      </a>
    </div>
  );
}
