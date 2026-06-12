"use client";
import { useState, useEffect } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { Check, ExternalLink, Lock } from "lucide-react";
import EbayListingModal from "./EbayListingModal";

interface Props {
  product: ProfitProduct | Product;
  onCountChange: (count: number) => void;
  // 「楽天で仕入れる」を押した端末だけ解放する。false の間はロック表示。
  unlocked?: boolean;
  // 設定完了→出品画面へ戻ってきた等で、最初から開く。
  autoOpen?: boolean;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, onCountChange, unlocked = true, autoOpen = false }: Props) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(false);
  const [hint, setHint] = useState(false);

  // 設定完了から戻ってきた場合は、ゲートに関係なく出品画面を開く。
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  // 出品成功 → ライバル数(出品カウント)を加算し、ボタンを「出品済み」に。
  const handleListed = () => {
    setListed(true);
    fetch(`/api/listing-count/${product.id}`, { method: "POST", keepalive: true })
      .then((r) => r.json())
      .then((d) => onCountChange(d.count))
      .catch(() => {});
  };

  const onClick = () => {
    if (!unlocked) {
      setHint(true);
      setTimeout(() => setHint(false), 2600);
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <div className="relative flex-1">
        <button
          type="button"
          onClick={onClick}
          aria-disabled={!unlocked}
          className={`
            w-full inline-flex items-center justify-center gap-1 h-11 whitespace-nowrap
            text-[13px] font-bold rounded-xl transition-all
            ${!unlocked
              ? "bg-gray-100 text-gray-400 border border-gray-200"
              : listed
              ? "bg-emerald-500 text-white"
              : "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
            }
          `}
        >
          {!unlocked ? <Lock size={13} /> : listed ? <Check size={14} /> : <ExternalLink size={14} />}
          {listed ? "出品済み！" : "eBay簡単出品"}
        </button>

        {/* ロック時のヒント（数秒で消える吹き出し） */}
        {hint && (
          <div className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 whitespace-nowrap bg-gray-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg">
            先に「楽天で仕入れる」を押してね
            <span className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-gray-900" />
          </div>
        )}
      </div>

      {open && isProfitProduct(product) && (
        <EbayListingModal product={product} onClose={() => setOpen(false)} onListed={handleListed} />
      )}
    </>
  );
}
