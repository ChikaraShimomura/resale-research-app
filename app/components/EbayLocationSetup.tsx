"use client";
import { useRef, useState } from "react";

interface AddrJa { prefecture: string; city: string; town: string }
interface AddrEn { stateOrProvince: string; city: string; town: string }

export default function EbayLocationSetup({ onDone }: { onDone?: () => void }) {
  const [zip, setZip] = useState("");
  const [addr, setAddr] = useState(""); // 番地・建物名・部屋番号（まとめて）
  const [ja, setJa] = useState<AddrJa | null>(null);
  const [en, setEn] = useState<AddrEn | null>(null);
  const [lookupMsg, setLookupMsg] = useState("");
  const [lookupFailed, setLookupFailed] = useState(false); // 自動検索が失敗（手入力に切替可）
  const [manual, setManual] = useState<AddrEn>({ stateOrProvince: "", city: "", town: "" });
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  // 入力ごとに進める世代番号。最新リクエストの応答だけを反映し、順序前後/古い応答の混入を防ぐ。
  const lookupGen = useRef(0);

  const onZip = (v: string) => {
    setZip(v);
    setState("idle");
    setMsg("");
    const digits = v.replace(/[^0-9]/g, "");
    const gen = ++lookupGen.current; // 入力のたび世代を進める＝in-flight の旧 lookup を無効化
    if (digits.length === 7) lookup(digits, gen);
    else {
      setJa(null);
      setEn(null);
      setLookupMsg("");
      setLookupFailed(false);
    }
  };

  const lookup = async (digits: string, gen: number) => {
    setLookupMsg("住所を検索中...");
    setLookupFailed(false);
    try {
      const r = await fetch(`/api/postal-lookup?zip=${digits}`, { cache: "no-store" }).then((x) => x.json());
      if (gen !== lookupGen.current) return; // 古い応答は破棄（zipとenの不一致を防ぐ）
      if (r.ok) {
        setJa(r.ja);
        setEn(r.en);
        setLookupMsg("");
        setLookupFailed(false);
      } else {
        setJa(null);
        setEn(null);
        setLookupMsg(r.error || "住所が見つかりませんでした");
        setLookupFailed(true); // 手入力に切替可能にする
      }
    } catch {
      if (gen !== lookupGen.current) return;
      // 失敗時も住所をクリア（古いenが残って新zipと食い違うのを防ぐ）
      setJa(null);
      setEn(null);
      setLookupMsg("住所検索に失敗しました");
      setLookupFailed(true);
    }
  };

  const submit = async () => {
    // 自動検索の結果(en)優先。失敗時は手入力(manual)を使う。
    const eff: AddrEn | null = en
      ? en
      : manual.stateOrProvince.trim() && manual.city.trim()
        ? manual
        : null;
    if (!eff) {
      setState("error");
      setMsg(lookupFailed ? "都道府県・市区町村を英字で入力してください。" : "先に郵便番号で住所を検索してください。");
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
          stateOrProvince: eff.stateOrProvince,
          city: eff.city,
          addressLine1: `${eff.town} ${addr.trim()}`.trim(),
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
        <label className="block text-[11px] text-gray-500 mb-0.5">郵便番号<span className="text-[#2D323B]"> *</span></label>
        <input
          type="text"
          inputMode="numeric"
          value={zip}
          onChange={(e) => onZip(e.target.value)}
          placeholder="100-0005"
          className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B]"
        />
        {lookupMsg && <p className={`text-[11px] mt-1 ${lookupFailed ? "text-[#2D323B]" : "text-gray-400"}`}>{lookupMsg}</p>}
        {lookupFailed && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mt-1.5 space-y-2">
            <p className="text-[11px] text-amber-800 leading-relaxed">
              自動で見つかりませんでした。<b>都道府県・市区町村を英字（ローマ字）で手入力</b>すれば、このまま続けられます。
            </p>
            <input
              type="text"
              value={manual.stateOrProvince}
              onChange={(e) => setManual((m) => ({ ...m, stateOrProvince: e.target.value }))}
              placeholder="都道府県（例: Tokyo）"
              className="w-full h-10 px-3 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:border-[#2D323B]"
            />
            <input
              type="text"
              value={manual.city}
              onChange={(e) => setManual((m) => ({ ...m, city: e.target.value }))}
              placeholder="市区町村（例: Chiyoda-ku）"
              className="w-full h-10 px-3 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:border-[#2D323B]"
            />
            <input
              type="text"
              value={manual.town}
              onChange={(e) => setManual((m) => ({ ...m, town: e.target.value }))}
              placeholder="町名（例: Marunouchi）任意"
              className="w-full h-10 px-3 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:border-[#2D323B]"
            />
          </div>
        )}
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
        <label className="block text-[11px] text-gray-500 mb-0.5">番地・建物名・部屋番号<span className="text-[#2D323B]"> *</span></label>
        <input
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="1-12-4 〇〇マンション 1001"
          className="w-full h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B]"
        />
        <p className="text-[10px] text-gray-400 mt-1 leading-snug">
          番地は数字でOK。建物名は英字がおすすめ（日本語のままだとそのまま登録されます）。
        </p>
      </div>

      <button
        onClick={submit}
        disabled={state === "saving"}
        className="mt-3 w-full h-11 bg-[#2D323B] text-white font-bold text-sm rounded-xl active:bg-[#1A1D23] disabled:opacity-50"
      >
        {state === "saving" ? "登録中..." : "発送元を登録"}
      </button>
      {msg && (
        <p className={`mt-2 text-[12px] font-bold ${state === "done" ? "text-emerald-600" : "text-[#2D323B]"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
