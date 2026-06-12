"use client";
import { useState } from "react";

const FIELDS = [
  { key: "postalCode", label: "郵便番号", placeholder: "100-0001", required: true },
  { key: "stateOrProvince", label: "都道府県（英字）", placeholder: "Tokyo", required: true },
  { key: "city", label: "市区町村（英字）", placeholder: "Chiyoda-ku", required: true },
  { key: "addressLine1", label: "番地（英字）", placeholder: "1-2-3 Marunouchi", required: true },
  { key: "addressLine2", label: "建物・部屋番号（任意）", placeholder: "#101", required: false },
] as const;

export default function EbayLocationSetup() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setState("saving");
    setMsg("");
    try {
      const res = await fetch("/api/ebay/create-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      const j = await res.json();
      if (j.ok) {
        setState("done");
        setMsg("発送元を登録しました。これで下書き作成の準備が一つ整いました。");
      } else {
        setState("error");
        setMsg(j.error || "登録に失敗しました。");
      }
    } catch {
      setState("error");
      setMsg("通信に失敗しました。時間をおいて再度お試しください。");
    }
  };

  return (
    <section className="mt-3 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-black text-gray-800 mb-1">発送元の登録（在庫ロケーション）</h3>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        「写真だけ出品」の下書き作成に必要です。eBay連携後に、海外発送ラベル用の発送元住所を英字で登録してください。
      </p>
      <div className="space-y-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-[11px] text-gray-500 mb-0.5">
              {f.label}
              {f.required && <span className="text-[#BF0000]"> *</span>}
            </label>
            <input
              type="text"
              value={vals[f.key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
            />
          </div>
        ))}
      </div>
      <button
        onClick={submit}
        disabled={state === "saving"}
        className="mt-3 w-full h-11 bg-[#BF0000] text-white font-bold text-sm rounded-xl active:bg-[#9E0000] disabled:opacity-50"
      >
        {state === "saving" ? "登録中..." : "発送元を登録"}
      </button>
      {msg && (
        <p className={`mt-2 text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#BF0000]"}`}>
          {msg}
        </p>
      )}
    </section>
  );
}
