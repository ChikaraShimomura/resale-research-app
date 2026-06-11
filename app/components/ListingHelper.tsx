"use client";
import { useState } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { toEbayListingUrl } from "../lib/utils";
import { generateEbayDescription } from "../lib/ebayDescription";
import { Check, ExternalLink } from "lucide-react";

interface Props {
  product: ProfitProduct | Product;
  onCountChange: (count: number) => void;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

// navigator.clipboard はHTTPS必須。失敗時は execCommand にフォールバック。
function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  } catch {
    /* noop */
  }
}

export default function ListingHelper({ product, onCountChange }: Props) {
  const [state, setState] = useState<"idle" | "done">("idle");

  const market = "market" in product ? product.market : undefined;
  const ebayUrl = toEbayListingUrl(product.coreKeyword || product.title, market);

  // ネイティブの target="_blank" に遷移を任せる（preventDefaultしない）。
  // 副作用（コピー・カウント）はawaitせずに同期発火 → user-activationを保ち、
  // ブラウザにポップアップブロックされずeBayタブが確実に開く。
  const handleListingClick = () => {
    const description = generateEbayDescription({
      title: product.title,
      price: product.source.price,
      ebayAvgPrice: isProfitProduct(product) ? product.realAvgPrice : undefined,
      market,
    });

    copyToClipboard(description);

    fetch(`/api/listing-count/${product.id}`, { method: "POST", keepalive: true })
      .then((r) => r.json())
      .then((d) => onCountChange(d.count))
      .catch(() => {});

    setState("done");
    setTimeout(() => setState("idle"), 3000);
  };

  return (
    <a
      href={ebayUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleListingClick}
      className={`
        flex items-center justify-center gap-1.5 w-full h-11 whitespace-nowrap
        text-sm font-bold rounded-xl transition-all
        ${state === "done"
          ? "bg-emerald-500 text-white"
          : "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
        }
      `}
    >
      {state === "done" ? <Check size={14} /> : <ExternalLink size={14} />}
      {state === "done" ? "コピー完了！eBayを開きます" : "eBay簡単出品"}
    </a>
  );
}
