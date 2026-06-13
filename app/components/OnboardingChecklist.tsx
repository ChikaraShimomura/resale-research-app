"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Circle, X, ChevronRight } from "lucide-react";

interface Step {
  key: string;
  label: string;
  cta?: { href: string; text: string };
  done: boolean;
}

// ホームの「はじめてガイド」。今どこ・次に何をするかを5ステップで可視化し、離脱を防ぐ。
// 端末の各シグナル（閲覧/仕入れ/連携/出品/売上）から自動で進捗を判定する。
export default function OnboardingChecklist() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem("ob_dismissed") === "1") return;
      } catch {
        /* noop */
      }

      let viewed = false;
      let purchased = false;
      let listedLocal = false;
      try {
        viewed = localStorage.getItem("ob_viewed") === "1";
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("rkt_") && localStorage.getItem(k) === "1") purchased = true;
          if (k && k.startsWith("listed_") && localStorage.getItem(k) === "1") listedLocal = true;
        }
      } catch {
        /* noop */
      }

      let connected = false;
      let soldCount = 0;
      let listedCount = 0;
      try {
        const rd = await fetch("/api/ebay/listing-readiness", { cache: "no-store" }).then((r) => r.json());
        connected = !!rd.connected;
      } catch {
        /* noop */
      }
      try {
        const j = await fetch("/api/ebay/stats", { cache: "no-store" }).then((r) => r.json());
        if (j.ok) {
          soldCount = j.stats.soldCount ?? 0;
          listedCount = j.stats.listedCount ?? 0;
        }
      } catch {
        /* noop */
      }

      setSteps([
        { key: "view", label: "利益商品を見る", cta: { href: "/search", text: "見る" }, done: viewed || purchased || listedCount > 0 },
        { key: "buy", label: "楽天で仕入れる", cta: { href: "/search", text: "探す" }, done: purchased || listedLocal || listedCount > 0 },
        { key: "connect", label: "eBayと連携する", cta: { href: "/settings", text: "連携" }, done: connected },
        { key: "list", label: "はじめて出品する", cta: { href: "/search", text: "出品" }, done: listedLocal || listedCount > 0 },
        { key: "sold", label: "はじめて売れる🎉", done: soldCount > 0 },
      ]);
      setHidden(false);
    })();
  }, []);

  if (hidden || !steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // 全部完了なら出さない
  const firstIncomplete = steps.findIndex((s) => !s.done);

  const dismiss = () => {
    try {
      localStorage.setItem("ob_dismissed", "1");
    } catch {
      /* noop */
    }
    setHidden(true);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[13px] font-black text-gray-800">
            はじめてガイド <span className="text-gray-400 font-bold">{doneCount}/{steps.length}</span>
          </h2>
          <button onClick={dismiss} aria-label="閉じる" className="text-gray-300 active:text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-[#BF0000] to-[#FF4466] transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ul className="space-y-1">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 ${i === firstIncomplete ? "bg-[#FFF0F4]" : ""}`}
            >
              {s.done ? (
                <Check size={16} className="text-emerald-500 shrink-0" />
              ) : (
                <Circle size={16} className={`shrink-0 ${i === firstIncomplete ? "text-[#BF0000]" : "text-gray-300"}`} />
              )}
              <span className={`flex-1 text-[13px] ${s.done ? "text-gray-400 line-through" : "text-gray-700 font-bold"}`}>
                {s.label}
              </span>
              {!s.done && i === firstIncomplete && s.cta && (
                <Link
                  href={s.cta.href}
                  className="inline-flex items-center gap-0.5 text-[12px] font-bold text-[#BF0000] active:opacity-70"
                >
                  {s.cta.text}
                  <ChevronRight size={14} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
