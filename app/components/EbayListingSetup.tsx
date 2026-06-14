"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronDown } from "lucide-react";
import EbayConnect from "./EbayConnect";
import EbayPolicySetup from "./EbayPolicySetup";
import EbayLocationSetup from "./EbayLocationSetup";

interface Readiness {
  connected?: boolean;
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
      // URLの ?list= が OAuth往復で失われても、出品モーダルが書いた storage から復元する。
      // アプリ内ブラウザは sessionStorage が消えやすいので localStorage もフォールバックに使う。
      const fromUrl = new URLSearchParams(window.location.search).get("list");
      setListId(
        fromUrl ??
          sessionStorage.getItem("ebay_list_after") ??
          localStorage.getItem("ebay_list_after")
      );
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
    (r?.fulfillmentPolicies ?? 0) > 0 && (r?.paymentPolicies ?? 0) > 0 && (r?.returnPolicies ?? 0) > 0,
    (r?.locations ?? 0) > 0,
  ];
  const doneCount = dones.filter(Boolean).length;
  const allDone = doneCount === dones.length;
  const firstIncomplete = dones.findIndex((d) => !d); // 全完了なら -1
  const openIdx = override ?? firstIncomplete;

  // 準備完了後の導線。自動遷移は「画面が勝手に変わって迷子」の原因になるため、
  // 明示ボタンで出品画面へ戻す。来歴(listId)があればその商品へ、無ければ検索へ。
  const continueToListing = useCallback(() => {
    try {
      sessionStorage.removeItem("ebay_list_after");
      localStorage.removeItem("ebay_list_after");
    } catch { /* noop */ }
    router.push(listId ? `/product/${encodeURIComponent(listId)}?list=1` : "/search");
  }, [listId, router]);

  const steps = [
    { title: "eBayと連携する", body: <EbayConnect onChange={refresh} /> },
    { title: "送料・支払い・返品を設定（おすすめのままでOK）", body: <EbayPolicySetup onDone={refresh} /> },
    { title: "発送元を登録", body: <EbayLocationSetup onDone={refresh} /> },
  ];

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 bg-white rounded-2xl border border-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-black text-gray-800">eBay自動出品の準備</h2>
        <span className="text-[11px] font-bold text-gray-400">{doneCount}/{dones.length} 完了</span>
      </div>

      {allDone && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4 space-y-3">
          <p className="text-[13px] font-bold text-emerald-700 flex items-center gap-2">
            <BadgeCheck size={16} /> 準備完了！あとは出品するだけです。
          </p>
          <button
            type="button"
            onClick={continueToListing}
            className="w-full h-12 bg-[#0064D2] text-white font-black text-sm rounded-xl active:bg-[#0053AE]"
          >
            {listId ? "この商品を出品する →" : "商品を探して出品する →"}
          </button>
          <p className="text-[11px] text-emerald-800 leading-relaxed">
            このあと<b>初回だけ</b>、eBayの<b>セラー登録（売上の受け取り設定）</b>に進みます。出品ボタンを押すと、そのまま画面の案内に沿って進められます。
          </p>
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
