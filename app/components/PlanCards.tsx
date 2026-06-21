"use client";
import { useState } from "react";
import { Check, Loader2, BadgeCheck } from "lucide-react";
import { PLANS, PAID_PLAN_IDS, TRIAL_DAYS, planRank, type PlanId } from "../lib/plans";

// 料金ページの有料プランカード。現在のプランに応じて出し分ける：
//  ・未購読(free) → Checkout で新規申込（「申し込む」/「無料ではじめる」）
//  ・購読中        → 現在のプランは「ご利用中」、上位は「アップグレード」、下位は「このプランに変更」。
//                   実際の切替は新規Checkout（=二重契約）を避け、Stripeカスタマーポータルで行う。
// PAYWALL_ENABLED のときだけ親(サーバー)から描画される。
export default function PlanCards({ currentPlan = "free" }: { currentPlan?: PlanId }) {
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isSubscriber = currentPlan === "amateur" || currentPlan === "veteran" || currentPlan === "pro";

  // 未購読 → 新規申込（Checkout）。
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
      if (d.ok && d.url) { window.location.href = d.url; return; }
      if (r.status === 401) setErr("お申し込みにはログインが必要です。");
      else setErr(d.error || "お申し込みを開始できませんでした。");
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(null);
    }
  };

  // 購読中 → プラン変更/解約はカスタマーポータルで（新規Checkoutだと二重契約になるため）。
  const openPortal = async () => {
    setBusy("portal");
    setErr(null);
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const d = await r.json();
      if (d.ok && d.url) { window.location.href = d.url; return; }
      setErr(d.error || "プラン管理画面を開けませんでした。");
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {(currentPlan === "master" || currentPlan === "admin") && (
        <p className="text-center text-[12px] text-emerald-600 font-bold mb-3">
          現在は無制限プラン（{PLANS[currentPlan].name}）をご利用中です。
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {PAID_PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const trial = id === "amateur";
          const isCurrent = id === currentPlan;
          const isUpgrade = planRank(id) > planRank(currentPlan);

          let label: string;
          if (isCurrent) label = "ご利用中";
          else if (!isSubscriber) label = trial ? "無料ではじめる" : "申し込む";
          else label = isUpgrade ? "アップグレード" : "このプランに変更";

          const onClick = isCurrent ? undefined : isSubscriber ? openPortal : () => subscribe(id);
          const thisBusy = busy === id || (isSubscriber && busy === "portal");

          return (
            <div
              key={id}
              className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col ${
                isCurrent ? "border-[#A98B5C] ring-1 ring-[#A98B5C]/40" : "border-[#A98B5C]/25"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-gray-800">{p.name}</p>
                {isCurrent && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#A98B5C] bg-[#A98B5C]/10 rounded-full px-2 py-0.5">
                    <BadgeCheck size={11} /> 現在
                  </span>
                )}
                {!isCurrent && isUpgrade && isSubscriber && (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">おすすめ</span>
                )}
              </div>
              <p className="mt-1">
                <span className="text-2xl font-black text-[#2D323B]">¥{p.priceJpy.toLocaleString()}</span>
                <span className="text-[12px] text-gray-400">/月</span>
              </p>
              {trial && !isSubscriber && (
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
                onClick={onClick}
                disabled={isCurrent || busy !== null}
                className={`mt-4 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-sm font-black disabled:opacity-60 ${
                  isCurrent ? "bg-gray-200 text-gray-500" : "bg-[#2D323B] text-white active:bg-[#1A1D23]"
                }`}
              >
                {thisBusy ? <Loader2 size={15} className="animate-spin" /> : null}
                {label}
              </button>
            </div>
          );
        })}
      </div>
      {err && <p className="text-[12px] text-red-600 mt-3 text-center">{err}</p>}
      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed text-center">
        {isSubscriber
          ? "プラン変更・解約はボタンから（Stripeの管理画面で手続き）。別途、楽天での仕入れ費用とeBay手数料がかかります。"
          : "いつでも解約できます。決済は Stripe（カード）。別途、楽天での仕入れ費用とeBay手数料がかかります。"}
      </p>
    </div>
  );
}
