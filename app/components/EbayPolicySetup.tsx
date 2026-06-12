"use client";
import { useState } from "react";
import { BadgeCheck, AlertTriangle } from "lucide-react";

interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
}

const SIZE_FIELDS = [
  { key: "small", label: "小さい荷物の送料（USD）", placeholder: "12" },
  { key: "medium", label: "中くらいの荷物の送料（USD）", placeholder: "25" },
  { key: "large", label: "大きい荷物の送料（USD）", placeholder: "45" },
] as const;

export default function EbayPolicySetup() {
  const [vals, setVals] = useState<Record<string, string>>({ handlingDays: "3" });
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setState("saving");
    setMsg("");
    setSteps([]);
    try {
      const res = await fetch("/api/ebay/setup-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handlingDays: Number(vals.handlingDays) || 3,
          small: vals.small,
          medium: vals.medium,
          large: vals.large,
        }),
      });
      const j = await res.json();
      if (Array.isArray(j.steps)) setSteps(j.steps);
      if (j.ok) {
        setState("done");
        setMsg("ビジネスポリシーを作成しました。出品準備チェックを再読み込みしてください。");
      } else {
        setState("error");
        setMsg(j.error || "一部のポリシー作成に失敗しました。下の結果を確認してください。");
      }
    } catch {
      setState("error");
      setMsg("通信に失敗しました。時間をおいて再度お試しください。");
    }
  };

  return (
    <section className="mt-3 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-black text-gray-800 mb-1">ビジネスポリシーの自動作成</h3>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        支払い・返品（返品不可）・配送ポリシーをeBayに自動登録します。eBay連携後にどうぞ。送料はサイズ別の一律料金（国際発送・USD）です。
      </p>

      <div className="space-y-2">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">発送までの日数（handling time）</label>
          <input
            type="text"
            inputMode="numeric"
            value={vals.handlingDays ?? ""}
            onChange={(e) => setVals((v) => ({ ...v, handlingDays: e.target.value }))}
            placeholder="3"
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
          />
        </div>
        {SIZE_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-[11px] text-gray-500 mb-0.5">{f.label}</label>
            <input
              type="text"
              inputMode="decimal"
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
            />
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-gray-400">返品ポリシー：返品不可（No returns）で作成します。</p>

      <button
        onClick={submit}
        disabled={state === "saving"}
        className="mt-3 w-full h-11 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000] disabled:opacity-50"
      >
        {state === "saving" ? "作成中..." : "ビジネスポリシーを作成"}
      </button>

      {steps.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              {s.ok ? (
                <BadgeCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              )}
              <span className={s.ok ? "text-gray-700" : "text-gray-600"}>
                {s.step}
                {!s.ok && s.error ? `：${s.error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {msg && (
        <p className={`mt-2 text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#BF0000]"}`}>
          {msg}
        </p>
      )}
    </section>
  );
}
