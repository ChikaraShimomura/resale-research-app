"use client";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { PLANS, PAID_PLAN_IDS, TRIAL_DAYS, type PlanId } from "../lib/plans";

// 料金ページの有料プランカード＋申込（Stripe Checkout）。
// PAYWALL_ENABLED のときだけ親(サーバー)から描画される。
export default function PlanCards() {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const subscribe = async (planId: PlanId) => {
    setBusy(planId);
    setErr(null);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const d = await r.json();
      if (d.ok && d.url) {
        window.location.href = d.url; // Stripeの決済ページへ
        return;
      }
      if (r.status === 401) setErr("お申し込みにはログインが必要です。");
      else setErr(d.error || "お申し込みを開始できませんでした。");
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {PAID_PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const trial = id === "amateur";
          return (
            <div key={id} className="bg-white rounded-2xl border border-[#A98B5C]/25 shadow-sm p-5 flex flex-col">
              <p className="text-sm font-black text-gray-800">{p.name}</p>
              <p className="mt-1">
                <span className="text-2xl font-black text-[#2D323B]">¥{p.priceJpy.toLocaleString()}</span>
                <span className="text-[12px] text-gray-400">/月</span>
              </p>
              {trial && (
                <p className="text-[11px] font-bold text-emerald-600 mt-0.5">最初の{TRIAL_DAYS}日間（約1ヶ月）無料</p>
              )}
              <ul className="mt-3 space-y-1.5 text-[12px] text-gray-600 flex-1">
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-emerald-500 shrink-0" />
                  同時出品 {p.listingLimit}件まで
                </li>
                <li className="flex items-center gap-1.5">
                  <Check size={13} className="text-emerald-500 shrink-0" />
                  利益リサーチ・写真だけ自動出品
                </li>
              </ul>
              <button
                onClick={() => subscribe(id)}
                disabled={busy !== null}
                className="mt-4 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-[#2D323B] text-white text-sm font-black disabled:opacity-50 active:bg-[#1A1D23]"
              >
                {busy === id ? <Loader2 size={15} className="animate-spin" /> : null}
                {trial ? "無料ではじめる" : "申し込む"}
              </button>
            </div>
          );
        })}
      </div>
      {err && <p className="text-[12px] text-red-600 mt-3 text-center">{err}</p>}
      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed text-center">
        いつでも解約できます。決済は Stripe（カード）。別途、楽天での仕入れ費用とeBay手数料がかかります。
      </p>
    </div>
  );
}
