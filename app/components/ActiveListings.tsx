"use client";
import { useEffect, useState } from "react";

interface LiveDeal { id: string; title: string; listedAt: string; purchase: number }

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const shortDate = (iso: string) => {
  const d = (iso || "").slice(0, 10);
  const m = d.slice(5, 7), day = d.slice(8, 10);
  return m && day ? `${Number(m)}/${Number(day)}` : "";
};

// マイページの「出品中の商品」一覧＋手動調整。
// 出品をやめた → 成績から外す／実は売れていた（検知漏れ）→ 売れた金額(円)で手動記録。
// 操作後は onChanged で親の集計を取り直してもらう。
export default function ActiveListings({ onChanged }: { onChanged?: () => void }) {
  const [deals, setDeals] = useState<LiveDeal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [soldFor, setSoldFor] = useState<string | null>(null); // 売れた金額を入力中の商品
  const [soldJpy, setSoldJpy] = useState("");

  const load = () => {
    fetch("/api/ebay/deals", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setDeals(j.ok ? j.deals : []))
      .catch(() => setDeals([]));
  };
  useEffect(() => { load(); }, []);

  const act = async (productId: string, action: "remove" | "sold", extra?: { soldJpy: number }) => {
    setBusy(productId);
    try {
      const res = await fetch("/api/ebay/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productId, ...extra }),
      }).then((r) => r.json());
      if (res.ok) {
        setDeals((cur) => (cur ?? []).filter((d) => d.id !== productId)); // 一覧から即時に外す
        setSoldFor(null);
        setSoldJpy("");
        onChanged?.(); // 親(マイページ)の集計を更新
      }
    } catch {
      /* noop */
    }
    setBusy(null);
  };

  if (deals === null || deals.length === 0) return null; // 読み込み中・出品中なしは出さない

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <p className="text-[13px] font-black text-gray-800 mb-1">出品中の商品（{deals.length}件）</p>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        出品をやめた・実は売れていた時は、ここで手動で調整できます。
      </p>
      <ul className="divide-y divide-gray-100">
        {deals.map((d) => (
          <li key={d.id} className="py-2.5">
            <span className="block text-[12px] text-gray-700 line-clamp-2 leading-snug">{d.title || "（無題の商品）"}</span>
            <span className="block text-[10px] text-gray-400 mt-0.5">
              {shortDate(d.listedAt) && `${shortDate(d.listedAt)} 出品　`}仕入れ {yen(d.purchase)}
            </span>

            {soldFor === d.id ? (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-500">売れた金額</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={soldJpy}
                  onChange={(e) => setSoldJpy(e.target.value)}
                  placeholder="円"
                  className="w-24 h-8 px-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:border-[#BF0000]"
                />
                <button
                  disabled={busy === d.id || !(Number(soldJpy) > 0)}
                  onClick={() => act(d.id, "sold", { soldJpy: Number(soldJpy) })}
                  className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-40"
                >
                  記録
                </button>
                <button onClick={() => { setSoldFor(null); setSoldJpy(""); }} className="h-8 px-2 text-[11px] text-gray-400">
                  取消
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <button
                  disabled={busy === d.id}
                  onClick={() => { setSoldFor(d.id); setSoldJpy(""); }}
                  className="h-8 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold disabled:opacity-40"
                >
                  売れた（手動）
                </button>
                <button
                  disabled={busy === d.id}
                  onClick={() => {
                    if (window.confirm("この商品を「出品中」から外しますか？（成績の出品数から除きます）")) act(d.id, "remove");
                  }}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-gray-500 text-[11px] font-bold disabled:opacity-40"
                >
                  出品をやめた
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
