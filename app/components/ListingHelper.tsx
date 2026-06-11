"use client";
import { useState } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { toEbayListingUrl } from "../lib/utils";
import { generateEbayDescription } from "../lib/ebayDescription";
import { Check, ExternalLink, AlertTriangle } from "lucide-react";

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
  const [showWarn, setShowWarn] = useState(false);

  const market = "market" in product ? product.market : undefined;
  const ebayUrl = toEbayListingUrl(product.coreKeyword || product.title, market);

  // モーダルの「出品ページへ進む」クリック時に副作用＋eBayを開く。
  // このクリック自体がユーザー操作なので window.open はブロックされない。
  const proceed = () => {
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

    window.open(ebayUrl, "_blank", "noopener,noreferrer");

    setShowWarn(false);
    setState("done");
    setTimeout(() => setState("idle"), 3000);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowWarn(true)}
        className={`
          flex-1 inline-flex items-center justify-center gap-1 h-11 whitespace-nowrap
          text-[13px] font-bold rounded-xl transition-all
          ${state === "done"
            ? "bg-emerald-500 text-white"
            : "bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
          }
        `}
      >
        {state === "done" ? <Check size={14} /> : <ExternalLink size={14} />}
        {state === "done" ? "コピー完了！" : "eBay簡単出品"}
      </button>

      {/* 無在庫転売への注意ポップアップ（eBay遷移の前に一拍置く） */}
      {showWarn && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="無在庫出品に関する注意"
          onClick={() => setShowWarn(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-10 h-10 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </span>
              <h3 className="font-black text-gray-900 text-base">ちょっと待って！</h3>
            </div>
            <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
              <span className="font-bold text-gray-900">無在庫出品は絶対やめときなよ。</span><br />
              トラブること多いし、アカウント停止のリスクもある。先に楽天で
              <span className="font-bold text-[#BF0000]">仕入れてから</span>出品すればいいじゃん。
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={proceed}
                className="w-full h-11 inline-flex items-center justify-center gap-1.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold text-sm rounded-xl active:scale-[0.99]"
              >
                <ExternalLink size={14} /> 仕入れ済み！出品ページへ
              </button>
              <button
                type="button"
                onClick={() => setShowWarn(false)}
                className="w-full h-11 text-gray-500 font-bold text-sm rounded-xl border border-gray-200 active:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
