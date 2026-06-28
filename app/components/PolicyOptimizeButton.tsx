"use client";

import { useState } from "react";
import { Truck, BadgeCheck, AlertTriangle } from "lucide-react";
import ReportableError from "./ReportableError";

// 配送ポリシーの最適化ボタン（マイページ）。
// 既存の配送ポリシーを検査し、米国キャリア(USPS等)/国際発送欠落を「正しい設定」へ直してeBayへ同期する。
// 正しいサービスコードは既存の正しいポリシーから読み戻す＝推測しない。連打しても冪等（重複は更新）。
interface Step {
  step: string;
  ok: boolean;
  error?: string;
  before?: string;
  after?: string;
  known?: boolean;
}

export default function PolicyOptimizeButton() {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [errKind, setErrKind] = useState<"known" | "unexpected" | undefined>(undefined);
  const [errDetail, setErrDetail] = useState<string | undefined>(undefined);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setSteps(null);
    setState("idle");
    try {
      const res = await fetch("/api/ebay/optimize-policies", { method: "POST" }).then((r) => r.json());
      if (Array.isArray(res.steps)) setSteps(res.steps);
      setErrKind(res.errorKind);
      setErrDetail(res.errorDetail);
      if (res.ok) {
        setState("done");
        setMsg(
          res.fixedCount > 0
            ? `配送ポリシーを${res.fixedCount}件、正しい設定（日本郵便で送れる・送料無料/定額・発送先を反映）に直しました。`
            : "すべて正しい設定でした（変更なし）。"
        );
      } else {
        setState("error");
        const stepMsg = Array.isArray(res.steps) ? res.steps.find((s: Step) => !s.ok)?.error : undefined;
        setMsg(res.errorKind === "unexpected" ? "一部で予期せぬエラーが出ました。" : stepMsg || res.error || "最適化できませんでした。");
      }
    } catch {
      setState("error");
      setMsg("通信エラーで最適化できませんでした。時間をおいて再度お試しを。");
    }
    setBusy(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-[#A98B5C]/25 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Truck size={18} className="text-[#A98B5C] shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-[13px] font-black text-[#2D323B]">配送ポリシーを最適化</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <span className="whitespace-nowrap">海外バイヤーに「送料見積もり依頼」と</span><wbr />
            <span className="whitespace-nowrap">出て売れない原因（米国USPS指定・</span><wbr />
            <span className="whitespace-nowrap">発送先不足）を検出して、</span><wbr />
            <span className="whitespace-nowrap">日本発で送れる設定に直します。</span>
          </p>
        </div>
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="w-full h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2D323B] text-white font-bold text-sm active:bg-[#1A1D23] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#2D323B]/40"
      >
        {busy ? "最適化中…" : "今すぐ最適化する"}
      </button>

      {steps && steps.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              {s.ok ? (
                <BadgeCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              )}
              <span className={s.ok ? "text-gray-700" : "text-gray-600"}>
                <b className="font-bold">{s.step}</b>
                {s.ok && s.after ? `：${s.after}` : ""}
                {!s.ok && s.error ? `：${s.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state === "error" && errKind === "unexpected" && (
        <ReportableError
          message="配送ポリシーの最適化で予期せぬエラーが発生しました。"
          errorKind="unexpected"
          errorDetail={errDetail}
          where="ebay_optimize_policies"
          className="mt-1"
        />
      )}

      {msg && (
        <p
          role="alert"
          aria-live="assertive"
          className={`text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#2D323B]"}`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
