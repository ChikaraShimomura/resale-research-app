"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { reportClientError, errToDetail } from "../lib/clientError";

// 利益カタログ各カード右上の♡。押すとお気に入り(used_fav)に登録/解除（per-actor）。/manage?tab=fav に一覧表示される。
// カタログからは消えない（仕入れた/非表示と違い triage ではなく、後で見返すブックマーク）。
// className で配置を上書き可（既定はカード角の絶対配置／カラム内に置く時は className を渡す）。
export default function FavoriteHeart({
  productId,
  initialFaved = false,
  className,
  refreshOnChange = false,
}: {
  productId: string;
  initialFaved?: boolean;
  className?: string;
  refreshOnChange?: boolean; // true=トグル成功後に router.refresh（お気に入りページで外したらカードを消す）
}) {
  const router = useRouter();
  const [faved, setFaved] = useState(initialFaved);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !faved;
    setFaved(next); // 楽観更新
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next ? "fav" : "unfav", productId }),
      }).then((r) => r.json());
      if (!res.ok) {
        setFaved(!next); // 失敗は戻す
        if (res?.errorKind !== "known") reportClientError("catalog_favorite_toggle", { action: "toggle_fav", endpoint: "/api/catalog/action", status: 0, productId, detail: res?.errorDetail || res?.error || "(no detail)" });
      } else if (refreshOnChange) router.refresh();
    } catch (e) {
      setFaved(!next);
      reportClientError("catalog_favorite_toggle", { action: "toggle_fav", endpoint: "/api/catalog/action", status: 0, productId, detail: `fetch例外: ${errToDetail(e)}` });
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={faved}
      aria-label={faved ? "お気に入りから外す" : "お気に入りに追加"}
      className={`${className ?? "absolute top-2 right-2 z-10"} w-11 h-11 rounded-full flex items-center justify-center border transition-colors active:scale-90 ${
        faved ? "bg-rose-50 border-rose-200 text-rose-500" : "bg-white/90 border-[#A98B5C]/30 text-gray-400"
      }`}
    >
      <Heart size={16} fill={faved ? "currentColor" : "none"} />
    </button>
  );
}
