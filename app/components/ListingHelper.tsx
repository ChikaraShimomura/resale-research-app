"use client";
import { Product } from "../types";
import { toEbayListingUrl } from "../lib/utils";

interface Props {
  product: Product;
  onCountChange: (count: number) => void;
}

export default function ListingHelper({ product, onCountChange }: Props) {
  const handleClick = async () => {
    try {
      const res = await fetch(`/api/listing-count/${product.id}`, { method: "POST" });
      const data = await res.json();
      onCountChange(data.count);
    } catch {
      // サイレントに無視
    }
  };

  return (
    <a
      href={toEbayListingUrl(product.title)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className="block w-full text-center py-1.5 bg-blue-50 text-blue-600 border border-blue-200 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors"
    >
      eBayで出品する ↗
    </a>
  );
}
