"use client";
import { useState } from "react";

interface AddrJa { prefecture: string; city: string; town: string }
interface AddrEn { stateOrProvince: string; city: string; town: string }

export default function EbayLocationSetup({ onDone }: { onDone?: () => void }) {
  const [zip, setZip] = useState("");
  const [addr, setAddr] = useState(""); // 番地・建物名・部屋番号（まとめて）
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
      const r = await fetch(`/api/postal-lookup?zip=${digits}`, { cache: "no-store" }).then((x) => x.json());
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
    if (!addr.trim()) {
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
          addressLine1: `${en.town} ${addr.trim()}`.trim(),
        }),
      }).then((x) => x.json());
      if (r.ok) {
        setState("done");
        setMsg("発送元を登録しました。");
        setTimeout(() => onDone?.(), 1200);
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
    <div>
      <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
        郵便番号を入れると住所を自動入力します。日本語のままでOK（eBayには自動で英字変換して登録します）。
      </p>

      <div>
        <label className="block text-[11px] text-gray-500 mb-0.5">郵便番号<span className="text-[#BF0000]"> *</span></label>
        <input
          type="text"
          inputMode="numeric"
          value={zip}
          onChange={(e) => onZip(e.target.value)}
          placeholder="100-0005"
          className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
        />
        {lookupMsg && <p className="text-[11px] text-gray-400 mt-1">{lookupMsg}</p>}
        {ja && en && (
          <div className="bg-[#F5F7FA] rounded-xl px-3 py-2 mt-1.5">
            <span className="text-[10px] text-gray-400 block mb-0.5">自動入力された住所</span>
            <span className="text-[13px] text-gray-800 font-medium">{ja.prefecture} {ja.city} {ja.town}</span>
            <span className="text-[10px] text-gray-400 block mt-1">
              eBay登録（英字）: {[en.town, en.city, en.stateOrProvince].filter(Boolean).join(", ")}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2">
        <label className="block text-[11px] text-gray-500 mb-0.5">番地・建物名・部屋番号<span className="text-[#BF0000]"> *</span></label>
        <input
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="1-12-4 〇〇マンション 1001"
          className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#BF0000]"
        />
        <p className="text-[10px] text-gray-400 mt-1 leading-snug">
          番地は数字でOK。建物名は英字がおすすめ（日本語のままだとそのまま登録されます）。
        </p>
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
    </div>
  );
}
