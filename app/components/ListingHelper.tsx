"use client";
import { useState, useEffect } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { Check, ExternalLink, Lock } from "lucide-react";
import EbayListingModal from "./EbayListingModal";
import { track } from "../lib/analytics";

interface Props {
  product: ProfitProduct | Product;
  // 「楽天で仕入れる」を押した端末だけ解放する。false の間はロック表示。
  unlocked?: boolean;
  // 設定完了→出品画面へ戻ってきた等で、最初から開く。
  autoOpen?: boolean;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, unlocked = true, autoOpen = false }: Props) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(false);
  const [hint, setHint] = useState(false);

  // 設定完了から戻ってきた場合は、ゲートに関係なく出品画面を開く。
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
      // 出品で解放集合(unlockedIds)から外れるため、同一タブの一覧へ再計算を通知
      window.dispatchEvent(new Event("rkt-changed"));
    } catch {
      /* noop */
    }
    setListed(true);
  };

  const onClick = () => {
    if (listed) return; // 出品済みは非アクティブ
    if (!unlocked) {
      setHint(true);
      setTimeout(() => setHint(false), 2600);
      return;
    }
    track("ebay_list_open", { product_id: product.id });
    setOpen(true);
  };

  return (
    <>
      <div className="relative flex-1">
        <button
          type="button"
          onClick={onClick}
          aria-disabled={!unlocked || listed}
          disabled={listed}
          className={`
            w-full inline-flex items-center justify-center gap-1 h-11 whitespace-nowrap
            text-[13px] font-bold rounded-xl transition-all
            ${listed
              ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-default"
              : !unlocked
              ? "bg-gray-100 text-gray-400 border border-gray-200"
              : "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
            }
          `}
        >
          {listed ? <Check size={14} /> : !unlocked ? <Lock size={13} /> : <ExternalLink size={14} />}
          {listed ? "出品済み" : !unlocked ? "先に楽天で仕入れ" : "eBay簡単出品"}
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
