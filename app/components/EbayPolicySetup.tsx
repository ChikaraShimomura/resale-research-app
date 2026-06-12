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

// 送料の既定値（国際発送・一律・USD）。ユーザー入力は任意で、最初からこの値が入る。
const DEFAULTS: Record<string, string> = { handlingDays: "3", small: "12", medium: "25", large: "45" };

export default function EbayPolicySetup({ onDone }: { onDone?: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({ ...DEFAULTS });
  const [showEdit, setShowEdit] = useState(false); // 送料を自分で変える（任意）
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
        setMsg("ビジネスポリシーを作成しました。");
        setTimeout(() => onDone?.(), 1200);
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
    <div>
      <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
        送料の設定です（<b className="text-gray-700">変更は任意</b>）。一般的な送料はすでに入っているので、
        特に変更がなければ、そのまま下のボタンを押すだけでOK（このデフォルト値で登録されます）。
        支払い・返品（返品不可）もまとめて自動登録します。
      </p>

      {/* 既定の送料サマリー（国際発送・一律・USD） */}
      <div className="bg-[#F5F7FA] rounded-xl px-3 py-2.5 text-[12px] text-gray-600 space-y-1">
        <div className="flex justify-between"><span>小さい荷物</span><span className="font-bold text-gray-800">${vals.small}</span></div>
        <div className="flex justify-between"><span>中くらいの荷物</span><span className="font-bold text-gray-800">${vals.medium}</span></div>
        <div className="flex justify-between"><span>大きい荷物</span><span className="font-bold text-gray-800">${vals.large}</span></div>
        <div className="flex justify-between text-gray-400"><span>発送までの日数</span><span>{vals.handlingDays}日</span></div>
      </div>

      <button
        type="button"
        onClick={() => setShowEdit((v) => !v)}
        className="mt-2 text-[11px] text-gray-500 underline underline-offset-2 active:text-gray-700"
      >
        {showEdit ? "編集を閉じる" : "送料を自分で変える（任意）"}
      </button>

      {showEdit && (
        <div className="space-y-2 mt-2">
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
      )}

      <p className="mt-2 text-[11px] text-gray-400">返品ポリシー：返品不可（No returns）で作成します。</p>

      <button
        onClick={submit}
        disabled={state === "saving"}
        className="mt-3 w-full h-11 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000] disabled:opacity-50"
      >
        {state === "saving" ? "登録中..." : "この送料で登録する"}
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
    </div>
  );
}
