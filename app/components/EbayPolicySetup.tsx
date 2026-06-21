"use client";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, AlertTriangle } from "lucide-react";
import ReportableError from "./ReportableError";
import { SHIP_TIER_USD } from "../lib/ebay/landedCost"; // 既定送料のSSOT（landedCostと一致＝利益計算の前提と揃う）

interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
  known?: boolean;
  errorDetail?: string;
}

// 送料の目安は日本郵便・米国宛の実費ベース：小=軽量エアパケット(〜500g≒¥2,040≒$14)／
// 中=〜1.2kg(≒¥3,500≒$23)／大=2kgやEMS・高額品(補償付き・$25〜)。アプリが商品の重さ・価格で自動選択する。
const SIZE_FIELDS = [
  { key: "small", label: "小（〜500g・軽量）の送料（USD）", placeholder: String(SHIP_TIER_USD.small) },
  { key: "medium", label: "中（〜1.2kg）の送料（USD）", placeholder: String(SHIP_TIER_USD.medium) },
  { key: "large", label: "大（2kgやEMS・高額品）の送料（USD）", placeholder: String(SHIP_TIER_USD.large) },
] as const;

// 送料の既定値（USD）。送り先の国に関わらず同じ料金で、サイズで料金が変わる。ユーザー入力は任意で、最初からこの値が入る。
// 既定は日本郵便・米国宛の実費に合わせた目安（赤字を出さない安全側）＝landedCostのSSOT(SHIP_TIER_USD)と一致。
const DEFAULTS: Record<string, string> = {
  handlingDays: "7",
  small: String(SHIP_TIER_USD.small),
  medium: String(SHIP_TIER_USD.medium),
  large: String(SHIP_TIER_USD.large),
};

export default function EbayPolicySetup({ onDone }: { onDone?: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({ ...DEFAULTS });
  const [showEdit, setShowEdit] = useState(false); // 送料を自分で変える（任意）
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [msg, setMsg] = useState("");
  const [errKind, setErrKind] = useState<"known" | "unexpected" | undefined>(undefined);
  const [errDetail, setErrDetail] = useState<string | undefined>(undefined);
  // 成功後の onDone 遅延発火タイマー。アンマウント/再submitで確実にクリアする。
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

  const submit = async () => {
    // 送料は半角数字(>0)のみ。非数値/全角があれば送信前に弾く（サーバーでも再検証）。
    const sizeVals = SIZE_FIELDS.map((f) => String(vals[f.key] ?? "").trim()).filter((v) => v !== "");
    if (sizeVals.length === 0 || sizeVals.some((v) => !(Number(v) > 0))) {
      setState("error");
      setMsg("送料は半角数字で1つ以上入力してください（例: 12）。");
      return;
    }
    if (doneTimer.current) {
      clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
    setState("saving");
    setMsg("");
    setSteps([]);
    try {
      const res = await fetch("/api/ebay/setup-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handlingDays: Number(vals.handlingDays) || 7,
          small: vals.small,
          medium: vals.medium,
          large: vals.large,
        }),
      });
      const j = await res.json();
      if (Array.isArray(j.steps)) setSteps(j.steps);
      setErrKind(j.errorKind);
      setErrDetail(
        Array.isArray(j.steps)
          ? j.steps.filter((s: StepResult) => !s.ok).map((s: StepResult) => `${s.step}: ${s.errorDetail || s.error || ""}`).join(" | ")
          : undefined
      );
      if (j.ok) {
        setState("done");
        setMsg("送料・支払い・返品の設定を登録しました。");
        doneTimer.current = setTimeout(() => {
          doneTimer.current = null;
          onDone?.();
        }, 1200);
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
        送料は<b className="text-gray-700">購入者が負担</b>します。出品時に<b className="text-gray-700">商品の重さ・価格からアプリが自動で小/中/大を選ぶ</b>ので、
        重い物や高額品（EMS）でも送料が足りず赤字…を防げます。金額の目安は日本郵便・米国宛の実費ベース
        （小=〜500g≒$14／中=〜1.2kg≒$25／大=2kgやEMS≒$45）。
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
              placeholder="7"
              className="w-full h-11 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B]"
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
                className="w-full h-11 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B]"
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-[12px] text-gray-400">返品の設定：返品不可（No returns）で登録します。<b className="text-gray-500">後からeBayの設定でいつでも変更できます。</b></p>

      <button
        onClick={submit}
        disabled={state === "saving"}
        className="w-full h-12 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23] disabled:opacity-50"
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

      {state === "error" && errKind === "unexpected" && (
        <ReportableError message="一部の設定で予期せぬエラーが発生しました。" errorKind="unexpected" errorDetail={errDetail} where="ebay_policy" className="mt-1" />
      )}

      {msg && (
        <p className={`text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#2D323B]"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
