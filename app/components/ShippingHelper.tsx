"use client";
import { useState } from "react";
import { Copy, Check, ExternalLink, Package } from "lucide-react";
import type { ShippingHelp } from "../lib/shipping";

export default function ShippingHelper({ help }: { help: ShippingHelp }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const copy = (text: string, key: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  };

  const rows: { key: string; label: string; value: string }[] = [
    { key: "item", label: "品名（英語）", value: help.itemDescriptionEn },
    { key: "type", label: "内容種別", value: help.contentType },
    { key: "value", label: "申告価格（USD）", value: `$${help.declaredValueUsd}` },
    { key: "qty", label: "数量", value: String(help.quantity) },
    { key: "hs", label: "HSコード（目安）", value: help.hsCode },
  ];

  return (
    <section className="mt-3 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <span className="w-8 h-8 rounded-xl bg-[#BF0000] text-white flex items-center justify-center shrink-0">
          <Package size={16} />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-black text-gray-800">海外発送ヘルパー</span>
          <span className="block text-[11px] text-gray-400">売れたときの発送方法と通関書類の英語</span>
        </span>
        <span aria-hidden="true" className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="bg-[#F5F7FA] rounded-xl px-3 py-2.5 mb-3">
            <p className="text-[11px] text-gray-500 mb-0.5">おすすめの発送方法</p>
            <p className="text-sm font-bold text-gray-800">{help.method}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{help.methodNote}</p>
          </div>

          <p className="text-[11px] font-bold text-gray-600 mb-1.5">通関書類（CN22/CN23）用 — コピーして使えます</p>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-28 shrink-0">{r.label}</span>
                <span className="flex-1 text-[13px] text-gray-800 font-medium break-all">{r.value}</span>
                <button
                  onClick={() => copy(r.value, r.key)}
                  aria-label={`${r.label}をコピー`}
                  className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-bold text-[#BF0000] px-2 py-1 rounded-lg border border-[#BF0000]/20 active:bg-[#BF0000]/5"
                >
                  {copied === r.key ? <Check size={12} /> : <Copy size={12} />}
                  {copied === r.key ? "済" : "コピー"}
                </button>
              </li>
            ))}
          </ul>

          <a
            href="https://www.int-mypage.post.japanpost.jp/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#BF0000] bg-[#BF0000]/5 border border-[#BF0000]/20 rounded-lg px-3 py-2 active:bg-[#BF0000]/10"
          >
            国際郵便マイページで送り状を作成 <ExternalLink size={13} />
          </a>

          <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">
            ※ HSコード・品名は目安です。高額品は追跡・補償の付く方法を推奨。発送前に内容物・価格・規制を必ずご確認ください。
          </p>
        </div>
      )}
    </section>
  );
}
