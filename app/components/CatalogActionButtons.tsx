"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, Undo2 } from "lucide-react";

// 中古カタログ各カードの小さな triage ボタン。「仕入れた」「これは無理」を per-actor で記録して一覧から外す。
// 「仕入れた」時はサーバーが仕入れ元の在庫を確認し、まだ在庫ありなら無在庫転売リスクを警告＋自動出品はプロMAX限定を案内。
export default function CatalogActionButtons({
  productId,
  buyJpy,
  isAdmin = false,
  canAutoList = false,
  teamOwner,
}: {
  productId: string;
  buyJpy: number;
  isAdmin?: boolean;
  canAutoList?: boolean;
  teamOwner?: string; // チーム共有モードで「オーナーのデータ」に仕入れる時のオーナーactor
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"bought" | "skip" | "undo" | null>(null);
  const [done, setDone] = useState<"bought" | "skip" | null>(null);
  const [inStock, setInStock] = useState(false); // 仕入れ元がまだ在庫あり＝無在庫転売の疑い
  const [err, setErr] = useState<string | null>(null);

  const post = async (action: "bought" | "skip" | "undo") => {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch("/api/catalog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 「仕入れた」は仕入れ値も送って収支の累計に乗せる（skip/undoでは無視される）。teamOwner指定時はオーナーのデータへ。
        body: JSON.stringify({ action, productId, buyJpy, teamOwner }),
      }).then((r) => r.json());
      if (res.ok) {
        if (action === "undo") {
          setDone(null);
          setInStock(false);
          router.refresh(); // 印を消してカタログに戻す
        } else {
          if (action === "bought") setInStock(res.availability === "in-stock"); // 在庫ありなら無在庫警告
          setDone(action); // カードはこのセッションは残し、次回読込でサーバーが非表示にする
        }
      } else {
        setErr(res.error || "操作に失敗しました。");
      }
    } catch {
      setErr("通信エラーで操作できませんでした。");
    }
    setBusy(null);
  };

  if (done) {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
          <span className="text-[11px] font-bold text-gray-600">
            {done === "bought" ? "✓「仕入れ商品」に追加しました" : "非表示にしました（次回から表示されません）"}
          </span>
          <button
            onClick={() => post("undo")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0064D2] disabled:opacity-40"
          >
            <Undo2 size={12} /> 元に戻す
          </button>
        </div>
        {/* 仕入れ元がまだ在庫あり＝無在庫転売の疑い→リスク提言＋自動出品はプロMAX限定を案内（ユーザー指示2026-06-27）。 */}
        {done === "bought" && inStock && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
            <p className="text-[11px] font-bold text-amber-800 leading-relaxed">⚠️ 仕入れ元でまだ「在庫あり」の商品です。</p>
            <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
              「売れてから仕入れる」<b>無在庫転売</b>は、欠品・価格変動・eBay規約違反（出品取消でアカウント評価低下）のリスクがあります。<b>在庫を確保してから</b>出品するのが安全です。
            </p>
            {!canAutoList && (
              <Link href="/pricing?from=catalog" className="mt-1.5 inline-block text-[11px] font-bold text-[#2D323B] underline underline-offset-2">
                ※ eBay自動出品は<b>プロMAX</b>プラン限定 → プランを見る
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        <button
          onClick={() => post("bought")}
          disabled={busy !== null}
          className="flex-1 inline-flex items-center justify-center gap-1 h-8 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40 active:bg-emerald-700"
        >
          <Check size={13} /> 仕入れた
        </button>
        {/* 管理者は「これは無理」(カタログ全体の判断用)、他ユーザーは「非表示(無理と判断)」表記。動作は同じ＝そのユーザーに非表示。 */}
        <button
          onClick={() => post("skip")}
          disabled={busy !== null}
          className="flex-1 inline-flex flex-col items-center justify-center gap-0 h-8 rounded-lg border border-gray-300 bg-white text-gray-500 text-[11px] font-bold disabled:opacity-40 active:bg-gray-50 leading-[1.05]"
        >
          {isAdmin ? (
            <span className="inline-flex items-center gap-1">
              <X size={13} /> これは無理
            </span>
          ) : (
            <>
              <span>非表示</span>
              <span className="text-[8px] font-normal text-gray-400">（無理と判断）</span>
            </>
          )}
        </button>
      </div>
      {err && <p className="mt-1 text-[10px] text-rose-600">{err}</p>}
    </div>
  );
}
