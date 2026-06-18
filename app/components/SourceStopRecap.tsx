"use client";
import { useEffect, useState } from "react";

// 仕入れ元(楽天)が売切/リンク切れで「自動で出品停止した商品」を、次にアプリを開いたときにまとめて報告するモーダル。
// 開いた瞬間に未処理ぶんの停止も実行（/api/ebay/list/reconcile）。1セッション1回だけ確認する。
interface Entry {
  id: string;
  title: string;
  imageUrl: string;
  reason: "dead" | "soldout";
  at: string;
}

const REASON: Record<Entry["reason"], string> = {
  soldout: "仕入れ元が売り切れ",
  dead: "仕入れ元がリンク切れ（掲載終了・閉店）",
};

export default function SourceStopRecap() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      if (sessionStorage.getItem("src_recap_done") === "1") return; // 1セッション1回
    } catch {
      /* sessionStorage不可でも続行 */
    }
    (async () => {
      try {
        const j = await fetch("/api/ebay/list/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).then((r) => r.json());
        if (!alive) return;
        try {
          sessionStorage.setItem("src_recap_done", "1");
        } catch {
          /* noop */
        }
        if (Array.isArray(j?.pending) && j.pending.length > 0) {
          setEntries(j.pending);
          setOpen(true);
        }
      } catch {
        /* 失敗時は何も出さない（次の起動で再取得） */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const close = async () => {
    setOpen(false);
    try {
      await fetch("/api/ebay/list/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ack: true }),
      });
    } catch {
      /* 確認の記録に失敗しても閉じる（次回また出るだけ） */
    }
  };

  if (!open || entries.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={close}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#A98B5C]/25 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-3 border-b border-[#A98B5C]/25">
          <h2 className="text-[15px] font-black text-gray-900">⚠️ 自動で出品を停止しました</h2>
          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
            仕入れ元（楽天）が売り切れ・リンク切れになった下記を、欠品キャンセルを防ぐため自動で出品停止しました。再開するときは「出品停止中の商品一覧」から再出品できます。
          </p>
        </div>
        <ul className="max-h-[46vh] overflow-y-auto divide-y divide-gray-50">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2.5 px-4 py-2.5">
              {e.imageUrl ? (
                <img src={e.imageUrl} alt="" loading="lazy" className="w-11 h-11 rounded-md object-cover border border-[#A98B5C]/35 bg-gray-50 shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-md bg-gray-100 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-[#2D323B] leading-tight">出品停止：{REASON[e.reason]}</p>
                <p className="text-[12px] text-gray-700 truncate mt-0.5">{e.title || e.id}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="p-3 border-t border-[#A98B5C]/25">
          <button
            onClick={close}
            className="w-full h-11 rounded-lg bg-[#2D323B] text-white text-sm font-bold active:bg-[#1A1D23]"
          >
            確認しました（{entries.length}件）
          </button>
        </div>
      </div>
    </div>
  );
}
