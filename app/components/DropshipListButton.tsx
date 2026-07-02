"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageX } from "lucide-react";
import EbayListingModal from "./EbayListingModal";
import type { ProfitProduct } from "../lib/profitFilter";
import { track } from "../lib/analytics";

// 「無在庫出品」＝仕入れ元(ハードオフ)にまだ在庫がある品を、先に買わずに eBay へ出品する。売れてから仕入れて発送する。
// 実行できるのはプロMAX以上(身内/管理者含む)＝canDropship。未満はプランページへ誘導（サーバー側でも publish が再判定して弾く）。
// EbayListingModal は product から id/title/coreKeyword しか読まず、価格/カテゴリ/画像等は prepare(id) が psnap から取得する
// ＝ここは最小限の product を渡せば足りる（型は ProfitProduct・実使用は3項目のみ）。
export default function DropshipListButton({
  productId,
  title,
  canDropship = false,
  onBehalfOf,
}: {
  productId: string;
  title: string;
  canDropship?: boolean;
  onBehalfOf?: string; // チーム共有：オーナー名義で出品する時のオーナーactor
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const product = { id: productId, title, coreKeyword: title } as unknown as ProfitProduct;

  const onClick = () => {
    if (!canDropship) {
      router.push("/pricing?from=dropship"); // プロMAX未満は無在庫出品できない→プラン誘導
      return;
    }
    track("dropship_list_open", { product_id: productId });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label="無在庫出品する"
        className="w-full inline-flex flex-col items-center justify-center gap-0.5 h-14 rounded-lg bg-[#2D323B] text-white text-[10px] font-bold leading-tight ring-1 ring-[#A98B5C]/60 active:bg-[#1A1D23]"
      >
        <PackageX size={15} className="text-[#A98B5C]" />
        <span>無在庫出品{!canDropship && <span className="text-[#A98B5C]">（プロMAX）</span>}</span>
      </button>
      {open && (
        <EbayListingModal product={product} onClose={() => setOpen(false)} onBehalfOf={onBehalfOf} dropship />
      )}
    </>
  );
}
