"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
// ★遅延読込(2026-07-11)：編集モーダル(EditListingModal+PhotoManager)はクリックで開く時だけ読む＝初期バンドルから除外。
const EditListingModal = dynamic(() => import("./EditListingModal"), { ssr: false });

// 出品中カードから「出品を編集」モーダル（価格・数量・送料の出し方・実物写真の追加）を開くチップボタン。
// manage（商品管理ハブ）はサーバーコンポーネントなので、モーダルの開閉状態を持つクライアント側の入口としてここに分離する。
export default function EditListingButton({ productId, title, compact = false }: { productId: string; title?: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl border border-[#2D323B]/30 bg-[#2D323B]/5 text-[#2D323B] font-bold text-[11px] leading-none active:bg-[#2D323B]/10 focus-visible:ring-2 focus-visible:ring-[#2D323B]/30"
        >
          <Pencil size={15} /> <span>編集</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-[#2D323B]/30 bg-[#2D323B]/5 text-[#2D323B] font-bold text-[12px] active:bg-[#2D323B]/10"
        >
          <Pencil size={14} /> 出品を編集
        </button>
      )}
      {open && (
        <EditListingModal
          productId={productId}
          title={title}
          onClose={() => setOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
