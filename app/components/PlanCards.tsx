"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, BadgeCheck, Star } from "lucide-react";
import { PLANS, PAID_PLAN_IDS, TRIAL_DAYS, planRank, type PlanId } from "../lib/plans";
import { logEvent } from "../lib/analytics";

// 各プランの「誰向け」位置づけ（文言のみ・新Priceは作らない）。アンカリングでスタンダードを推す。
const PLAN_PERSONA: Record<string, string> = {
  amateur: "まずは試す人に",
  veteran: "副業を伸ばす人に",
  pro: "本格的に取り組む人に",
};

// 料金ページの有料プランカード。現在のプランに応じて出し分ける：
//  ・未購読(free) → Checkout で新規申込（「申し込む」/「無料ではじめる」）
//  ・購読中        → 現在のプランは「ご利用中」、上位は「アップグレード」、下位は「このプランに変更」。
//                   実際の切替は新規Checkout（=二重契約）を避け、Stripeカスタマーポータルで行う。
// PAYWALL_ENABLED のときだけ親(サーバー)から描画される。
// resumePlan: ログイン後に /pricing?resume=<id> で戻ってきた時、その有料プランの Checkout を自動再開する。
export default function PlanCards({ currentPlan = "free", resumePlan }: { currentPlan?: PlanId; resumePlan?: PlanId }) {
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isSubscriber = currentPlan === "amateur" || currentPlan === "veteran" || currentPlan === "pro";

  // 未購読 → 新規申込（Checkout）。未ログイン(401)なら /login?from=checkout&plan=<id> へ送り、
  // ログイン成功後に /pricing?resume=<id> へ戻して Checkout を自動再開する（申込導線を切らさない）。
  const subscribe = async (planId: PlanId) => {
    setBusy(planId);
    setErr(null);
    logEvent("checkout_start"); // 収益ファネル：申し込み開始（Stripe Checkoutへ）
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const d = await r.json();
      if (d.ok && d.url) { window.location.href = d.url; return; }
      if (r.status === 401) { window.location.href = `/login?from=checkout&plan=${planId}`; return; }
      else setErr(d.error || "お申し込みを開始できませんでした。");
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(null);
    }
  };

  // ログイン直後の申込自動再開。resumePlan が有効な有料プランの時だけ1回だけ Checkout を起動する。
  // 起動は microtask に逃がす（effect 本体での同期 setState=カスケード描画を避ける）。多重起動は ref で防止。
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!resumePlan || !PAID_PLAN_IDS.includes(resumePlan)) return;
    if (isSubscriber) return; // 既に購読済みなら自動申込しない（二重契約防止）
    resumedRef.current = true;
    queueMicrotask(() => void subscribe(resumePlan));
    // subscribe は描画毎に再生成されるが、resumedRef のガードで多重起動を防ぐため依存に含めない。
  }, [resumePlan, isSubscriber]);

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
          無制限プラン（{PLANS[currentPlan].name}）をご利用中。
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {PAID_PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const trial = id === "amateur";
          const isCurrent = id === currentPlan;
          const isUpgrade = planRank(id) > planRank(currentPlan);
          const popular = id === "veteran"; // 推奨＝スタンダード（アンカリング）。表示のみ。

          let label: string;
          if (isCurrent) label = "ご利用中";
          else if (!isSubscriber) label = trial ? "無料ではじめる" : "申し込む";
          else label = isUpgrade ? "アップグレード" : "このプランに変更";

          const onClick = isCurrent ? undefined : isSubscriber ? openPortal : () => subscribe(id);
          const thisBusy = busy === id || (isSubscriber && busy === "portal");

          return (
            <div
              key={id}
              className={`relative bg-white rounded-2xl border shadow-sm p-5 flex flex-col ${
                isCurrent
                  ? "border-[#A98B5C] ring-1 ring-[#A98B5C]/40"
                  : popular
                  ? "border-[#A98B5C] ring-1 ring-[#A98B5C]/40"
                  : "border-[#A98B5C]/25"
              }`}
            >
              {/* 人気バッジ＝スタンダードに集める（アンカリング）。現在プラン表示と被らない時だけ。 */}
              {popular && !isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 text-[10px] font-black text-white bg-[#A98B5C] rounded-full px-2.5 py-0.5 shadow-sm">
                  <Star size={10} className="fill-white" /> 人気
                </span>
              )}
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
              {/* 誰向けか（位置づけラベル・文言のみ）。 */}
              {PLAN_PERSONA[id] && (
                <p className="text-[11px] text-gray-500 mt-0.5">{PLAN_PERSONA[id]}</p>
              )}
              <p className="mt-1">
                <span className="text-2xl font-black text-[#2D323B]">¥{p.priceJpy.toLocaleString()}</span>
                <span className="text-[12px] text-gray-400">/月</span>
              </p>
              {trial && !isSubscriber && (
                <p className="text-[11px] font-bold text-emerald-600 mt-0.5">最初の{TRIAL_DAYS}日間無料</p>
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
              {/* 申込ボタン直下の不安解消（未購読のみ）。ライト=無料期間の安心、上位=トライアルはライトのみ。 */}
              {!isSubscriber && trial && (
                <p className="text-[10.5px] text-gray-500 mt-2 leading-relaxed text-center">
                  無料期間中は0円・終了前にメール通知・ワンタップ解約
                </p>
              )}
              {!isSubscriber && !trial && (
                <p className="text-[10.5px] text-gray-400 mt-2 leading-relaxed text-center">
                  無料はライトのみ・後からアップグレード可
                </p>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="text-[12px] text-red-600 mt-3 text-center">{err}</p>}
      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed text-center">
        {isSubscriber
          ? "プラン変更・解約はボタンから（Stripe管理画面）。別途、楽天の仕入れ費用とeBay手数料がかかります。"
          : "いつでも解約OK。決済はStripe（カード）。別途、楽天の仕入れ費用とeBay手数料がかかります。"}
      </p>
    </div>
  );
}
