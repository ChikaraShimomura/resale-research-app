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
  // 既に出品済み（アカウント基準＝別端末で出した分も含む）。検索一覧から渡す。
  defaultListed?: boolean;
}

function isProfitProduct(p: ProfitProduct | Product): p is ProfitProduct {
  return "realAvgPrice" in p;
}

export default function ListingHelper({ product, autoOpen = false, defaultListed = false }: Props) {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState(defaultListed);

  // 設定完了から戻ってきた場合は出品画面を開く。
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  // 出品済みは端末に記録されている。再訪時も「出品済み」表示にする。
  useEffect(() => {
    try {
      if (localStorage.getItem(`listed_${product.id}`) === "1") setListed(true);
    } catch {
      /* noop */
    }
  }, [product.id]);

  // アカウント基準の出品済み（別端末で出した分・サーバーSKU対応表）が後から届いたら反映。
  useEffect(() => {
    if (defaultListed) setListed(true);
  }, [defaultListed]);

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

  // 出品済み：行き止まりにせず「出品管理(/listings)」へ飛べるリンクにする。
  // ⚠️ モーダルが開いている間(出品中→完了画面表示中)は早期returnしない。出品成功時に
  //    setPhase('done') と同バッチで onListed→setListed(true) が走るため、早期returnすると
  //    モーダルごとunmountされ「出品完了」画面が一瞬で消える。閉じてから出品済み表示へ。
  if (listed && !open) {
    return (
      <div className="flex-1">
        <a
          href="/listings"
          className="w-full inline-flex items-center justify-center gap-1 h-12 whitespace-nowrap text-[13px] font-bold rounded-xl bg-gray-100 text-gray-500 border border-[#A98B5C]/35 active:bg-gray-200"
        >
          <Check size={14} /> 出品済み・管理を見る
        </a>
      </div>
    );
  }

  return (
    <div className="flex-1">
      <button
        type="button"
        onClick={onClick}
        className="w-full inline-flex items-center justify-center gap-1 h-12 whitespace-nowrap text-[13px] font-bold rounded-xl transition-all bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600 active:scale-[0.99]"
      >
        <ExternalLink size={14} /> eBay自動出品
      </button>

      {open && isProfitProduct(product) && (
        <EbayListingModal product={product} onClose={() => setOpen(false)} onListed={handleListed} />
      )}
    </div>
  );
}
