"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronDown } from "lucide-react";
import EbayConnect from "./EbayConnect";
import EbayPolicySetup from "./EbayPolicySetup";
import EbayLocationSetup from "./EbayLocationSetup";
import EbaySellerGuide from "./EbaySellerGuide";

interface Readiness {
  connected?: boolean;
  sellerRegistered?: boolean | null;
  fulfillmentPolicies?: number;
  paymentPolicies?: number;
  returnPolicies?: number;
  locations?: number;
}

export default function EbayListingSetup() {
  const router = useRouter();
  const [r, setR] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  // null = STEP自動開閉、数値 = そのSTEPを手動で開く、-1 = すべて閉じる
  const [override, setOverride] = useState<number | null>(null);
  // 「eBay簡単出品」から来た場合、商品IDが ?list= に入っている。全完了したら出品画面へ戻す。
  const [listId, setListId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setListId(new URLSearchParams(window.location.search).get("list"));
    } catch {
      /* noop */
    }
  }, []);

  const refresh = useCallback(() => {
    fetch("/api/ebay/listing-readiness", { cache: "no-store" })
      .then((x) => x.json())
      .then((d: Readiness) => {
        setR(d);
        setOverride(null); // 登録完了で自動的に次のSTEPへ
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const dones = [
    !!r?.connected,
    r?.sellerRegistered === true,
    (r?.fulfillmentPolicies ?? 0) > 0 && (r?.paymentPolicies ?? 0) > 0 && (r?.returnPolicies ?? 0) > 0,
    (r?.locations ?? 0) > 0,
  ];
  const doneCount = dones.filter(Boolean).length;
  const allDone = doneCount === dones.length;
  const firstIncomplete = dones.findIndex((d) => !d); // 全完了なら -1
  const openIdx = override ?? firstIncomplete;

  // 全STEP完了かつ「eBay簡単出品」から来た場合、その商品の出品画面へ自動で戻す。
  useEffect(() => {
    if (!loading && allDone && listId) {
      router.push(`/product/${encodeURIComponent(listId)}?list=1`);
    }
  }, [loading, allDone, listId, router]);

  const steps = [
    { title: "eBayと連携する", body: <EbayConnect /> },
    {
      title: "セラー登録（売上の受け取り）",
      body: (
        <div>
          <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
            eBayで「出品できるセラー」になるための登録です。本人確認とPayoneer（売上の受け取り）の設定を含みます。
            <b className="text-gray-600">この手続きはeBayのページで行います（アプリ内では完了できません）。</b>
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://www.ebay.com/sl/sell"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 h-11 px-5 bg-[#0064D2] text-white font-bold text-sm rounded-xl active:bg-[#0053AE]"
            >
              eBayでセラー登録する
            </a>
            <button
              onClick={refresh}
              className="inline-flex items-center h-11 px-4 text-sm font-bold text-gray-600 border border-gray-300 rounded-xl active:bg-gray-50"
            >
              完了を確認
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 leading-relaxed">
            登録が終わったら「完了を確認」を押すと、チェックが付きます（eBay側の反映に少し時間がかかる場合があります）。
          </p>
          <EbaySellerGuide />
        </div>
      ),
    },
    { title: "ビジネスポリシーを作成", body: <EbayPolicySetup onDone={refresh} /> },
    { title: "発送元を登録", body: <EbayLocationSetup onDone={refresh} /> },
  ];

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-black text-gray-800">写真だけ出品の準備</h2>
        <span className="text-[11px] font-bold text-gray-400">{doneCount}/{dones.length} 完了</span>
      </div>

      {allDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-[13px] font-bold text-emerald-700 flex items-center gap-1.5">
          <BadgeCheck size={16} /> 準備完了！「写真だけ出品」が使えます。
        </div>
      )}

      {steps.map((s, i) => {
        const done = dones[i];
        const isOpen = openIdx === i;
        return (
          <div
            key={i}
            className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors ${
              isOpen ? "border-[#BF0000]/40" : "border-gray-100"
            }`}
          >
            <button
              type="button"
              onClick={() => setOverride(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${
                  done
                    ? "bg-emerald-500 text-white"
                    : isOpen
                    ? "bg-[#BF0000] text-white"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {done ? <BadgeCheck size={16} /> : i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-black text-gray-800">
                  STEP {i + 1}：{s.title}
                </span>
                <span className={`block text-[11px] ${done ? "text-emerald-600" : "text-gray-400"}`}>
                  {done ? "完了" : "未完了"}
                </span>
              </span>
              <ChevronDown
                size={18}
                className={`text-gray-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen && <div className="px-4 pb-4 pt-1 border-t border-gray-50">{s.body}</div>}
          </div>
        );
      })}
    </div>
  );
}
