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

// 送料の既定値（USD）。送り先の国に関わらず同じ料金で、サイズで料金が変わる。ユーザー入力は任意で、最初からこの値が入る。
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
        setMsg("送料・支払い・返品の設定を登録しました。");
        setTimeout(() => onDone?.(), 1200);
      } else {
        setState("error");
        setMsg(j.error || "一部の設定の登録に失敗しました。下の結果を確認してください。");
      }
    } catch {
      setState("error");
      setMsg("通信に失敗しました。時間をおいて再度お試しください。");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-gray-500 leading-relaxed">
        送料・支払い・返品の設定です（<b className="text-gray-700">変更は任意</b>）。一般的な送料はすでに入っているので、
        特に変更がなければ、そのまま下のボタンを押すだけでOK（このまま登録されます）。
        支払いと返品（返品不可）もまとめて自動で登録します。
      </p>

      <div className="bg-gray-50 rounded-xl px-4 py-3 text-[12px] text-gray-500 leading-relaxed">
        送料は<b className="text-gray-700">購入者が負担</b>します。送り先の国に関わらず同じ料金で、
        荷物のサイズによって料金が変わります。
      </div>

      {/* 既定の送料サマリー（サイズ別・USD） */}
      <div className="bg-gray-50 rounded-xl p-4 text-[13px] text-gray-500 space-y-2">
        <div className="flex justify-between items-center"><span>小さい荷物</span><span className="font-bold text-gray-800">${vals.small}</span></div>
        <div className="flex justify-between items-center"><span>中くらいの荷物</span><span className="font-bold text-gray-800">${vals.medium}</span></div>
        <div className="flex justify-between items-center"><span>大きい荷物</span><span className="font-bold text-gray-800">${vals.large}</span></div>
        <div className="flex justify-between items-center text-gray-400 pt-1"><span>発送までの日数</span><span>{vals.handlingDays}日</span></div>
      </div>

      <button
        type="button"
        onClick={() => setShowEdit((v) => !v)}
        className="text-[12px] text-gray-500 underline underline-offset-2 active:text-gray-700"
      >
        {showEdit ? "編集を閉じる" : "送料を自分で変える（任意）"}
      </button>

      {showEdit && (
        <div className="space-y-3">
          <div>
            <label className="block text-[12px] text-gray-500 mb-1">発送までの日数（注文から何日で送るか）</label>
            <input
              type="text"
              inputMode="numeric"
              value={vals.handlingDays ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, handlingDays: e.target.value }))}
              placeholder="3"
              className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
            />
          </div>
          {SIZE_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-[12px] text-gray-500 mb-1">{f.label}</label>
              <input
                type="text"
                inputMode="decimal"
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-[12px] text-gray-400">返品の設定：返品不可（No returns）で登録します。</p>

      <button
        onClick={submit}
        disabled={state === "saving"}
        className="w-full h-12 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000] disabled:opacity-50"
      >
        {state === "saving" ? "登録中..." : "この内容で登録する"}
      </button>

      {steps.length > 0 && (
        <ul className="space-y-2">
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
        <p className={`text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#BF0000]"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
