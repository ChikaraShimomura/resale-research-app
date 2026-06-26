"use client";
import { useEffect, useState } from "react";
import { readListingDefaults, writeListingDefaults } from "../lib/prefs";

// 出品の既定値（この端末に保存）。出品モーダルを開いたときの初期値として使われる。
// 毎回同じ設定を選び直さなくて済むようにするための設定。商品の状態(新品/中古)は商品名から自動判定するので含めない。
export default function ListingDefaultsSettings() {
  const [handlingDays, setHandlingDays] = useState("3");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const d = readListingDefaults();
    setHandlingDays(String(d.handlingDays));
  }, []);

  const save = () => {
    const hd = Math.min(30, Math.max(1, Math.floor(Number(handlingDays) || 3)));
    writeListingDefaults({ handlingDays: hd });
    setHandlingDays(String(hd));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-black text-gray-800">出品の既定値</h2>
        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
          出品画面を開いたときの初期値（この端末に保存）。商品ごとに変更可。
          状態（新品/中古）は仕入れ元から自動判定するので含めません。中古は手元に在庫があるので発送は早め（既定3日）。
        </p>
      </div>

      <div>
        <label className="block text-[12px] text-gray-500 mb-1">発送までの日数（落札から何日で発送）</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={handlingDays}
            onChange={(e) => setHandlingDays(e.target.value)}
            placeholder="3"
            className="w-28 h-10 px-3 rounded-xl border border-[#A98B5C]/35 text-sm focus:outline-none focus:border-[#2D323B]"
          />
          <span className="text-[12px] text-gray-400">日（1〜30）</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="h-10 px-5 rounded-xl bg-[#2D323B] text-white text-sm font-bold active:bg-[#1A1D23]"
        >
          保存する
        </button>
        {saved && <p className="text-[12px] font-bold text-emerald-600">保存しました。</p>}
      </div>
    </div>
  );
}
