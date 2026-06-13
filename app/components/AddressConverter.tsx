"use client";
import { useState, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { normalizeBanchi, formatZip } from "../lib/jpAddress";

interface AddrJa { prefecture: string; city: string; town: string }
interface AddrEn { stateOrProvince: string; city: string; town: string }
interface TownCandidate { ja: string; en: string }

// 出力1行（ラベル＋英語の値＋コピーボタン）。値は長押しで手動コピーできるよう選択可能にする。
function OutRow({
  label, sub, value, copyKey, copied, onCopy,
}: {
  label: string; sub: string; value: string; copyKey: string; copied: string; onCopy: (k: string, v: string) => void;
}) {
  const isCopied = copied === copyKey;
  return (
    <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-100 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-400 leading-tight">
          {label} <span className="text-gray-300">/ {sub}</span>
        </p>
        <p className="text-[13px] font-bold text-gray-800 break-all leading-snug select-all">{value || "—"}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(copyKey, value)}
        disabled={!value}
        aria-label={`${label}をコピー`}
        className={`shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-bold transition-colors ${
          isCopied ? "bg-emerald-50 text-emerald-600" : "bg-[#BF0000]/10 text-[#BF0000] active:bg-[#BF0000]/20"
        } disabled:opacity-40`}
      >
        {isCopied ? <Check size={13} /> : <Copy size={13} />}
        {isCopied ? "コピー済" : "コピー"}
      </button>
    </div>
  );
}

export default function AddressConverter() {
  const [zip, setZip] = useState("");
  const [banchi, setBanchi] = useState("");
  const [building, setBuilding] = useState("");
  const [ja, setJa] = useState<AddrJa | null>(null);
  const [en, setEn] = useState<AddrEn | null>(null);
  const [townCandidates, setTownCandidates] = useState<TownCandidate[]>([]);
  const [townIdx, setTownIdx] = useState(0);
  const [lookupMsg, setLookupMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");
  const [copyErr, setCopyErr] = useState(false);
  const reqId = useRef(0); // 最新リクエストだけ反映する（古いfetchの上書き防止）

  const onZip = (v: string) => {
    setZip(v);
    const digits = v.replace(/[^0-9]/g, "");
    if (digits.length === 7) lookup(digits);
    else {
      reqId.current++; // 進行中のfetchを無効化
      setJa(null); setEn(null); setTownCandidates([]); setLookupMsg(""); setLoading(false);
    }
  };

  const lookup = async (digits: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setLookupMsg("");
    try {
      const r = await fetch(`/api/postal-lookup?zip=${digits}`, { cache: "no-store" }).then((x) => x.json());
      if (id !== reqId.current) return; // 古い応答は破棄
      if (r.ok) {
        setJa(r.ja);
        setEn(r.en);
        setTownCandidates(Array.isArray(r.townCandidates) ? r.townCandidates : []);
        setTownIdx(0);
        setLookupMsg("");
      } else {
        setJa(null); setEn(null); setTownCandidates([]);
        setLookupMsg(r.error || "住所が見つかりませんでした。");
      }
    } catch {
      if (id !== reqId.current) return;
      setJa(null); setEn(null); setTownCandidates([]);
      setLookupMsg("住所検索に失敗しました。通信状況をご確認ください。");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  // 選択中の町名（複数候補があれば選択、無ければ en/ja の town）
  const selTown = townCandidates.length > 0 ? townCandidates[townIdx] ?? townCandidates[0] : null;
  const townEn = selTown ? selTown.en : en?.town ?? "";
  const townJa = selTown ? selTown.ja : ja?.town ?? "";

  // 英語の出力パーツ
  const banchiNorm = normalizeBanchi(banchi);
  const line1 = en ? [banchiNorm, townEn].filter(Boolean).join(" ") : "";
  const line2 = building.trim();
  const city = en?.city ?? "";
  const stateProvince = en?.stateOrProvince ?? "";
  const zipFmt = formatZip(zip);
  const country = "Japan";
  const buildingHasJa = /[ぁ-んァ-ヶ一-龯]/.test(building);
  const fullBlock = en ? [line1, line2, city, stateProvince, zipFmt, country].filter(Boolean).join("\n") : "";

  const copy = async (key: string, text: string) => {
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }
    if (ok) {
      setCopyErr(false);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1400);
    } else {
      setCopyErr(true);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-[#BF0000]/30 bg-[#BF0000]/[0.03] overflow-hidden">
      {/* 見出し */}
      <div className="bg-[#BF0000] px-3.5 py-2.5">
        <p className="text-white text-[13px] font-black leading-tight">🔤 住所を英語に変換（コピペ用ツール）</p>
        <p className="text-white/85 text-[11px] mt-0.5 leading-snug">
          郵便番号を入れるだけ。出てきた英語をボタンでコピーして、上のフォームの同じ欄に貼り付けてください。
        </p>
      </div>

      <div className="p-3.5 space-y-3">
        {/* 郵便番号 */}
        <div>
          <label className="block text-[11px] font-bold text-gray-600 mb-1">
            ① 郵便番号（7桁）<span className="text-[#BF0000]">*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={zip}
            onChange={(e) => onZip(e.target.value)}
            placeholder="100-0005"
            className="w-full h-11 px-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#BF0000]"
          />
          <div aria-live="polite">
            {loading && <p className="text-[11px] text-gray-400 mt-1">住所を検索中…</p>}
            {!loading && lookupMsg && <p className="text-[11px] text-[#BF0000] mt-1 font-bold">{lookupMsg}</p>}
            {ja && (
              <div className="bg-white rounded-xl px-3 py-2 mt-1.5 border border-gray-100">
                <p className="text-[10px] text-gray-400 leading-tight">自動で見つかった住所（この内容で合っていますか？）</p>
                <p className="text-[13px] text-gray-800 font-bold leading-snug">
                  {[ja.prefecture, ja.city, townJa].filter(Boolean).join(" ")}
                </p>
              </div>
            )}
          </div>
          {/* 町名が複数ある郵便番号は選ばせる */}
          {townCandidates.length > 1 && (
            <div className="mt-1.5">
              <label className="block text-[10px] text-[#BF0000] font-bold mb-0.5">
                この郵便番号は町名が複数あります。住所の町名を選んでください
              </label>
              <select
                value={townIdx}
                onChange={(e) => setTownIdx(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#BF0000]"
              >
                {townCandidates.map((t, i) => (
                  <option key={i} value={i}>
                    {t.ja}（{t.en}）
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 番地 */}
        <div>
          <label className="block text-[11px] font-bold text-gray-600 mb-1">
            ② 番地（丁目・番・号）<span className="text-[#BF0000]">*</span>
          </label>
          <input
            type="text"
            value={banchi}
            onChange={(e) => setBanchi(e.target.value)}
            placeholder="例: 1-2-3"
            className="w-full h-11 px-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#BF0000]"
          />
          <p className="text-[10px] text-gray-400 mt-1 leading-snug">
            「1丁目2番3号」は <b>1-2-3</b> と入れればOK（数字とハイフンで）。
          </p>
        </div>

        {/* 建物名・部屋番号 */}
        <div>
          <label className="block text-[11px] font-bold text-gray-600 mb-1">③ 建物名・部屋番号（任意）</label>
          <input
            type="text"
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            placeholder="例: 101 / Sunny Heights 101"
            className="w-full h-11 px-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#BF0000]"
          />
          <p className="text-[10px] text-gray-400 mt-1 leading-snug">
            建物名は<b>ローマ字</b>で（自動変換できません）。部屋番号だけでもOK。
          </p>
          {buildingHasJa && (
            <p className="text-[10px] text-[#BF0000] font-bold mt-1 leading-snug">
              ⚠️ 建物名に日本語が含まれています。ローマ字に直してください（Payoneer等は英数字のみ）。
            </p>
          )}
        </div>

        {/* 出力 */}
        {en ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black text-gray-700">↓ これをフォームに貼り付け</p>
              <button
                type="button"
                onClick={() => copy("all", fullBlock)}
                disabled={!banchiNorm}
                className={`inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-black transition-colors disabled:opacity-40 ${
                  copied === "all" ? "bg-emerald-600 text-white" : "bg-[#BF0000] text-white active:bg-[#9E0000]"
                }`}
              >
                {copied === "all" ? <Check size={13} /> : <Copy size={13} />}
                {copied === "all" ? "コピーしました" : "全部コピー"}
              </button>
            </div>

            <OutRow label="国 / 住所の国" sub="Country" value={country} copyKey="country" copied={copied} onCopy={copy} />
            <OutRow label="郵便番号" sub="ZIP / Postal code" value={zipFmt} copyKey="zip" copied={copied} onCopy={copy} />
            <OutRow label="都道府県" sub="State / Prefecture" value={stateProvince} copyKey="state" copied={copied} onCopy={copy} />
            <OutRow label="市区町村" sub="City" value={city} copyKey="city" copied={copied} onCopy={copy} />
            <OutRow label="住所1（番地＋町名）" sub="Address line 1" value={line1} copyKey="line1" copied={copied} onCopy={copy} />
            {line2 && (
              <OutRow label="住所2（建物・部屋）" sub="Address line 2" value={line2} copyKey="line2" copied={copied} onCopy={copy} />
            )}

            {!banchiNorm && (
              <p className="text-[10px] text-[#BF0000] font-bold leading-snug">
                ② 番地を入力すると「住所1」が完成します（番地が空だと貼り付けできません）。
              </p>
            )}
            {en && !townEn && (
              <p className="text-[10px] text-amber-600 leading-snug">
                ※ この郵便番号は町名が自動で出ません。②に番地、必要なら町名（ローマ字）も入れてください。
              </p>
            )}
            <div aria-live="polite">
              {copyErr && (
                <p className="text-[11px] text-[#BF0000] font-bold leading-snug">
                  コピーできませんでした。上の文字を長押しして手動でコピーしてください。
                </p>
              )}
            </div>
            <p className="text-[10px] text-gray-400 leading-snug pt-0.5">
              ※ 変換は目安です。<b>お名前はローマ字</b>（例: TARO YAMADA）で、住所は<b>身分証と同じ</b>になっているか確認を。
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 text-center py-1">
            郵便番号を入れると、ここに<b className="text-gray-500">コピペできる英語住所</b>が出ます。
          </p>
        )}
      </div>
    </div>
  );
}
