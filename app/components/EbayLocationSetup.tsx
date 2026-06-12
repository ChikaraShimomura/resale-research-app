"use client";
import { useState } from "react";

interface AddrJa { prefecture: string; city: string; town: string }
interface AddrEn { stateOrProvince: string; city: string; town: string }

export default function EbayLocationSetup() {
  const [zip, setZip] = useState("");
  const [banchi, setBanchi] = useState("");
  const [building, setBuilding] = useState("");
  const [ja, setJa] = useState<AddrJa | null>(null);
  const [en, setEn] = useState<AddrEn | null>(null);
  const [lookupMsg, setLookupMsg] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const onZip = (v: string) => {
    setZip(v);
    setState("idle");
    setMsg("");
    const digits = v.replace(/[^0-9]/g, "");
    if (digits.length === 7) lookup(digits);
    else {
      setJa(null);
      setEn(null);
      setLookupMsg("");
    }
  };

  const lookup = async (digits: string) => {
    setLookupMsg("住所を検索中...");
    try {
      const r = await fetch(`/api/postal-lookup?zip=${digits}`).then((x) => x.json());
      if (r.ok) {
        setJa(r.ja);
        setEn(r.en);
        setLookupMsg("");
      } else {
        setJa(null);
        setEn(null);
        setLookupMsg(r.error || "住所が見つかりませんでした");
      }
    } catch {
      setLookupMsg("住所検索に失敗しました");
    }
  };

  const submit = async () => {
    if (!en) {
      setState("error");
      setMsg("先に郵便番号で住所を検索してください。");
      return;
    }
    if (!banchi.trim()) {
      setState("error");
      setMsg("番地を入力してください。");
      return;
    }
    setState("saving");
    setMsg("");
    try {
      const r = await fetch("/api/ebay/create-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postalCode: zip,
          stateOrProvince: en.stateOrProvince,
          city: en.city,
          addressLine1: `${en.town} ${banchi.trim()}`.trim(),
          addressLine2: building.trim(),
        }),
      }).then((x) => x.json());
      if (r.ok) {
        setState("done");
        setMsg("発送元を登録しました。出品準備チェックを再読み込みしてください。");
      } else {
        setState("error");
        setMsg(r.error || "登録に失敗しました。");
      }
    } catch {
      setState("error");
      setMsg("通信に失敗しました。");
    }
  };

  return (
    <section className="mt-3 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-black text-gray-800 mb-1">発送元の登録（在庫ロケーション）</h3>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        郵便番号を入れると住所を自動入力します。日本語のままでOK（eBayには自動で英字変換して登録します）。
      </p>

      <div className="space-y-2">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">郵便番号<span className="text-[#BF0000]"> *</span></label>
          <input
            type="text"
            inputMode="numeric"
            value={zip}
            onChange={(e) => onZip(e.target.value)}
            placeholder="130-0012"
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
          />
          {lookupMsg && <p className="text-[11px] text-gray-400 mt-1">{lookupMsg}</p>}
        </div>

        {ja && (
          <div className="bg-[#F5F7FA] rounded-xl px-3 py-2 text-[13px] text-gray-700">
            <span className="text-[10px] text-gray-400 block mb-0.5">自動入力された住所</span>
            {ja.prefecture} {ja.city} {ja.town}
          </div>
        )}

        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">番地（丁目・番地・号）<span className="text-[#BF0000]"> *</span></label>
          <input
            type="text"
            value={banchi}
            onChange={(e) => setBanchi(e.target.value)}
            placeholder="1-12-4"
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">建物・部屋番号（任意）</label>
          <input
            type="text"
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            placeholder="#1001"
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
          />
        </div>
      </div>

      {en && (banchi || building) && (
        <p className="mt-2 text-[11px] text-gray-400 leading-snug">
          eBay登録（英字）: {[`${en.town} ${banchi}`.trim(), building, en.city, en.stateOrProvince, zip, "Japan"].filter(Boolean).join(", ")}
        </p>
      )}

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
