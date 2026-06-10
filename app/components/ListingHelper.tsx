"use client";
import { useState } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { toEbayListingUrl } from "../lib/utils";
import { generateEbayDescription } from "../lib/ebayDescription";
import { Check, ExternalLink, Loader2 } from "lucide-react";

interface Props {
  product: ProfitProduct | Product;
  onCountChange: (count: number) => void;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, onCountChange }: Props) {
  // idle → copying → done
  const [state, setState] = useState<"idle" | "copying" | "done">("idle");

  const ebayAvgPrice = isProfitProduct(product) ? product.realAvgPrice : undefined;

  const handleListingClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault(); // いったん止めてコピー処理を先にやる

    setState("copying");

    // 1. 説明文生成
    const description = generateEbayDescription({
      title: product.title,
      price: product.source.price,
      ebayAvgPrice,
    });

    // 2. クリップボードへコピー
    try {
      await navigator.clipboard.writeText(description);
    } catch {
      // フォールバック
      const el = document.createElement("textarea");
      el.value = description;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    // 3. 出品カウント記録
    try {
      const res = await fetch(`/api/listing-count/${product.id}`, { method: "POST" });
      const data = await res.json();
      onCountChange(data.count);
    } catch {
      // サイレント
    }

    // 4. 完了表示
    setState("done");

    // 5. eBay出品ページを開く
    const listingTitle = product.coreKeyword || product.title;
    window.open(toEbayListingUrl(listingTitle), "_blank", "noopener,noreferrer");

    // 3秒後にリセット
    setTimeout(() => setState("idle"), 3000);
  };

  return (
    <a
      href={toEbayListingUrl(product.coreKeyword || product.title)}
      onClick={handleListingClick}
      className={`
        flex items-center justify-center gap-1.5 w-full py-2.5
        text-sm font-bold rounded-xl border-2 transition-all
        ${state === "done"
          ? "bg-emerald-500 border-emerald-500 text-white"
          : "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
        }
      `}
    >
      {state === "copying" && <Loader2 size={14} className="animate-spin" />}
      {state === "done"   && <Check size={14} />}
      {state === "idle"   && <ExternalLink size={14} />}

      {state === "copying" && "準備中..."}
      {state === "done"    && "説明文をコピー済み！eBayが開きます"}
      {state === "idle"    && "eBay簡単出品"}
    </a>
  );
}
