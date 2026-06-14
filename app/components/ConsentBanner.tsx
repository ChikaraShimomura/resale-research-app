"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const KEY = "cookie_consent_v1";

// Cookie同意バナー（Google Consent Mode v2 連動）。
// layout 側で analytics_storage は既定 'denied'。同意で 'granted' に更新する。
export default function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const v = localStorage.getItem(KEY);
    if (v === "granted") {
      window.gtag?.("consent", "update", { analytics_storage: "granted" });
      return;
    }
    if (v === "denied") return;
    setShow(true);
  }, []);

  const decide = (granted: boolean) => {
    try {
      localStorage.setItem(KEY, granted ? "granted" : "denied");
    } catch {
      /* noop */
    }
    if (granted) window.gtag?.("consent", "update", { analytics_storage: "granted" });
    // 同一タブの A2HS バナー等へ「Cookie同意が決まった」ことを通知し再評価させる
    try {
      window.dispatchEvent(new Event("consent-decided"));
    } catch {
      /* noop */
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookieの利用について"
      className="fixed inset-x-0 bottom-0 z-50 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-2xl mx-auto px-4 py-3.5 flex flex-col gap-2.5">
        <p className="text-[12.5px] text-gray-700 leading-relaxed">
          本サイトは、利用状況の分析（Google Analytics）のためにCookieを使用します。詳しくは
          <Link href="/privacy" className="text-[#BF0000] underline mx-0.5">プライバシーポリシー</Link>
          をご覧ください。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => decide(false)}
            className="flex-1 h-10 bg-gray-100 text-gray-600 font-bold text-[13px] rounded-xl active:bg-gray-200"
          >
            拒否する
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="flex-1 h-10 bg-[#BF0000] text-white font-bold text-[13px] rounded-xl active:bg-[#9E0000]"
          >
            同意する
          </button>
        </div>
      </div>
    </div>
  );
}
