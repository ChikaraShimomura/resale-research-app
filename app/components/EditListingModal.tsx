"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Spinner from "./Spinner";

// 出品中の「価格・数量」をアプリ内で編集するモーダル。
// eBay.comを開かずに直せる＝出品の管理がeBayサイト側へ移って詰む原因を作らない。
export default function EditListingModal({
  productId,
  title,
  onClose,
  onSaved,
}: {
  productId: string;
  title?: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [priceUsd, setPriceUsd] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ebay/list/edit?id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok) {
          if (j.priceUsd != null) setPriceUsd(String(j.priceUsd));
          if (j.quantity != null) setQuantity(String(j.quantity));
        } else {
          setLoadError(j?.error || "出品情報を取得できませんでした。");
        }
      })
      .catch(() => alive && setLoadError("通信エラーで出品情報を取得できませんでした。"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [productId]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const j = await fetch("/api/ebay/list/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, priceUsd, quantity: Number(quantity) }),
      }).then((r) => r.json());
      if (j?.ok) {
        setDone(true);
        onSaved?.();
        setTimeout(onClose, 900);
      } else {
        setSaveError(j?.error || "更新に失敗しました。");
      }
    } catch {
      setSaveError("通信エラーで更新できませんでした。");
    }
    setSaving(false);
  };

  const priceOk = Number(priceUsd) >= 0.01;
  const qtyOk = Number(quantity) >= 1 && Number(quantity) <= 30;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-100 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-black text-gray-900">出品を編集</h2>
            {title && <p className="text-[11px] text-gray-400 truncate mt-0.5">{title}</p>}
          </div>
          <button onClick={onClose} aria-label="閉じる" className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-100 shrink-0">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-[12px]">
            <Spinner size={16} /> 出品情報を読み込み中…
          </div>
        ) : loadError ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2.5 leading-relaxed">
            {loadError}
          </div>
        ) : done ? (
          <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-[13px] px-3 py-3 text-center font-bold">
            ✓ 反映しました
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[12px] font-bold text-gray-700">価格（USD）</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#BF0000]/30 focus:border-[#BF0000]"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-bold text-gray-700">数量（在庫数・1〜30）</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="30"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#BF0000]/30 focus:border-[#BF0000]"
              />
              <span className="text-[10px] text-gray-400 mt-1 block">在庫を持っている数だけにしてください（無在庫で複数を出すと欠品キャンセルの原因に）。</span>
            </label>

            {saveError && <p className="text-[12px] text-[#BF0000] leading-relaxed">{saveError}</p>}

            <button
              onClick={save}
              disabled={saving || !priceOk || !qtyOk}
              className="w-full h-11 rounded-lg bg-[#BF0000] text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Spinner size={14} /> 反映中…
                </>
              ) : (
                "この内容で更新"
              )}
            </button>
            <p className="text-[10px] text-gray-400 leading-relaxed text-center">
              実物写真の追加は準備中です。タイトルや写真の変更はeBay側で行うと出品の管理が外れる場合があるため、近日アプリ内対応します。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
