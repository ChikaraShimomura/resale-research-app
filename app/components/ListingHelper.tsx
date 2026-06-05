"use client";
import { useState } from "react";
import { Product } from "../types";
import { ProfitProduct } from "../lib/profitFilter";
import { toEbayListingUrl } from "../lib/utils";
import { generateEbayDescription } from "../lib/ebayDescription";
import { Copy, Check, X, FileText } from "lucide-react";

interface Props {
  product: ProfitProduct | Product;
  onCountChange: (count: number) => void;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, onCountChange }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const ebayAvgPrice = isProfitProduct(product) ? product.realAvgPrice : undefined;

  const description = generateEbayDescription({
    title: product.title,
    price: product.source.price,
    ebayAvgPrice,
  });

  const handleListingClick = async () => {
    try {
      const res = await fetch(`/api/listing-count/${product.id}`, { method: "POST" });
      const data = await res.json();
      onCountChange(data.count);
    } catch {
      // サイレントに無視
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // フォールバック: テキストエリア経由
      const el = document.createElement("textarea");
      el.value = description;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <>
      {/* ボタン行 */}
      <div className="flex gap-2">
        {/* 説明文生成ボタン */}
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center justify-center gap-1.5 flex-1 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium rounded-lg hover:bg-emerald-100 active:bg-emerald-200 transition-colors"
        >
          <FileText size={12} />
          出品文を生成
        </button>

        {/* eBay出品ページを開くボタン */}
        <a
          href={toEbayListingUrl(product.title)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleListingClick}
          className="flex items-center justify-center gap-1 flex-1 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 text-xs font-medium rounded-lg hover:bg-blue-100 active:bg-blue-200 transition-colors"
        >
          eBayで出品 ↗
        </a>
      </div>

      {/* 説明文モーダル */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh]">
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-800">📋 eBay出品説明文</p>
                <p className="text-xs text-gray-400 mt-0.5">英語＋日本語バイリンガル</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* 説明文プレビュー */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 rounded-xl p-3 border border-gray-100">
                {description}
              </pre>
            </div>

            {/* アクションボタン */}
            <div className="px-4 py-4 border-t border-gray-100 shrink-0 space-y-2">
              {/* コピーボタン */}
              <button
                onClick={handleCopy}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
                  copied
                    ? "bg-emerald-500 text-white"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800"
                }`}
              >
                {copied ? (
                  <><Check size={16} /> コピーしました！</>
                ) : (
                  <><Copy size={16} /> 説明文をコピー</>
                )}
              </button>

              {/* eBay出品ページを開くボタン */}
              <a
                href={toEbayListingUrl(product.title)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleListingClick}
                className="block w-full text-center py-2.5 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                eBayの出品ページを開く ↗
              </a>

              <p className="text-xs text-gray-400 text-center">
                コピーしてeBayのDescription欄に貼り付けてください
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
