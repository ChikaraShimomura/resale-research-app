"use client";
import { useState } from "react";

interface Target { conn: string; productId: string; sku: string; title: string; listingId?: string; rateListing: number; rateSold: number; ok?: boolean; ended?: boolean; error?: string }

// 管理者専用：直近落札で「過大評価（現状○→落札✕）」になった商品の出品中リストを一括停止。
// プレビュー(GET)で対象を確認→停止実行(POST)。eBay鍵はサーバーにしか無いのでここから叩く。
export default function AdminStopOverstated() {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [results, setResults] = useState<Target[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function preview() {
    setBusy(true); setErr(""); setResults(null);
    try {
      const r = await fetch("/api/admin/stop-overstated", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) { setErr(j.error || "取得に失敗しました。"); setTargets(null); }
      else setTargets(j.targets ?? []);
    } catch { setErr("通信に失敗しました。"); }
    setBusy(false);
  }

  async function execute() {
    if (!targets?.length) return;
    if (!confirm(`${targets.length}件の出品をeBayで停止します。よろしいですか？（再出品は可能）`)) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/admin/stop-overstated", { method: "POST", cache: "no-store" });
      const j = await r.json();
      if (!j.ok) setErr(j.error || "停止に失敗しました。");
      else { setResults(j.results ?? []); setTargets(null); }
    } catch { setErr("通信に失敗しました。"); }
    setBusy(false);
  }

  return (
    <div>
      <h2 className="text-sm font-black text-gray-800 mb-1">赤字出品の一括停止</h2>
      <p className="text-[11px] text-gray-500 mb-3">
        eBay直近落札で見ると赤字（現状は利益ありと表示していた）の商品で、いまeBayに出品中のものをまとめて停止します。
      </p>

      <div className="flex gap-2">
        <button onClick={preview} disabled={busy}
          className="px-3 h-9 rounded-lg bg-[#2D323B] text-white text-[13px] font-bold disabled:opacity-50 active:scale-95">
          {busy && !results ? "確認中…" : "対象をプレビュー"}
        </button>
        {targets && targets.length > 0 && (
          <button onClick={execute} disabled={busy}
            className="px-3 h-9 rounded-lg bg-[#BF0000] text-white text-[13px] font-bold disabled:opacity-50 active:scale-95">
            {busy ? "停止中…" : `${targets.length}件を停止実行`}
          </button>
        )}
      </div>

      {err && <p className="text-[12px] text-[#BF0000] mt-2">{err}</p>}

      {targets && (
        <div className="mt-3">
          {targets.length === 0 ? (
            <p className="text-[12px] text-emerald-700 font-bold">停止対象なし（出品中の赤字商品はありません）。</p>
          ) : (
            <>
              <p className="text-[12px] text-gray-700 font-bold mb-1">停止対象 {targets.length} 件：</p>
              <ul className="space-y-1 max-h-72 overflow-auto">
                {targets.map((t) => (
                  <li key={`${t.conn}:${t.productId}`} className="text-[11px] text-gray-600 border-b border-gray-100 pb-1">
                    <span className="text-[#BF0000] font-bold">率{t.rateListing}%→{t.rateSold}%</span>{" "}
                    {t.title}<span className="text-gray-400"> （{t.productId}）</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {results && (
        <div className="mt-3">
          <p className="text-[12px] font-bold text-gray-800 mb-1">
            停止完了：{results.filter((r) => r.ok).length}/{results.length} 件
          </p>
          <ul className="space-y-1 max-h-72 overflow-auto">
            {results.map((r) => (
              <li key={`${r.conn}:${r.productId}`} className="text-[11px] border-b border-gray-100 pb-1">
                <span className={r.ok ? "text-emerald-700 font-bold" : "text-[#BF0000] font-bold"}>{r.ok ? "✅停止" : "❌失敗"}</span>{" "}
                {r.title}{r.error ? <span className="text-gray-400"> — {r.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
