"use client";
import { useEffect, useState } from "react";

interface Status {
  connected: boolean;
  configured: boolean;
}

export default function EbayConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<"connected" | "error" | null>(null);

  useEffect(() => {
    // コールバックからの ?ebay=connected / error を一度だけ表示
    const p = new URLSearchParams(window.location.search).get("ebay");
    if (p === "connected" || p === "error") {
      setFlash(p);
      window.history.replaceState(null, "", window.location.pathname);
    }
    fetch("/api/ebay/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {flash === "connected" && (
        <p className="mb-3 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          ✅ eBayと連携しました
        </p>
      )}
      {flash === "error" && (
        <p className="mb-3 text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠️ 連携に失敗しました。もう一度お試しください
        </p>
      )}

      {loading ? (
        <div className="h-11 w-40 bg-gray-100 rounded-xl animate-pulse" />
      ) : !status?.configured ? (
        <p className="text-sm text-gray-500">
          eBay連携は現在準備中です（サーバー設定の反映待ち）。
        </p>
      ) : status.connected ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700">
            ✅ eBay連携済み
          </span>
          <a
            href="/api/ebay/connect"
            className="inline-flex items-center min-h-[44px] text-sm font-semibold text-gray-600 border border-gray-300 rounded-xl px-4 active:bg-gray-50"
          >
            再連携する
          </a>
        </div>
      ) : (
        <a
          href="/api/ebay/connect"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] text-sm font-bold text-white bg-[#0064D2] rounded-xl px-5 active:bg-[#0053AE]"
        >
          <span className="inline-flex w-5 h-5 bg-white rounded-full items-center justify-center text-[#0064D2] font-black text-[10px]">
            e
          </span>
          eBayアカウントと連携する
        </a>
      )}
    </div>
  );
}
