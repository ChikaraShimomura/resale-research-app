"use client";
import { useEffect, useState } from "react";
import { BadgeCheck, AlertTriangle } from "lucide-react";

interface Status {
  connected: boolean;
  configured: boolean;
}

export default function EbayConnect({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<"connected" | "error" | "disconnected" | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

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

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/ebay/disconnect", { method: "POST" });
      setStatus((s) => (s ? { ...s, connected: false } : s));
      setFlash("disconnected");
      onChange?.(); // 親(セットアップ)へ通知して readiness を再取得し、STEP/準備完了バナーを最新化
    } catch {
      /* noop */
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div>
      {flash === "connected" && (
        <p className="mb-3 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <BadgeCheck size={16} /> eBayと連携しました
        </p>
      )}
      {flash === "error" && (
        <p className="mb-3 text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={16} /> 連携に失敗しました。もう一度お試しください
        </p>
      )}
      {flash === "disconnected" && (
        <p className="mb-3 text-sm font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          この端末のeBay連携を解除しました
        </p>
      )}

      {loading ? (
        <div className="h-11 w-40 bg-gray-100 rounded-xl animate-pulse" />
      ) : !status?.configured ? (
        <p className="text-sm text-gray-500">
          eBay連携は現在準備中です（サーバー設定の反映待ち）。
        </p>
      ) : status.connected ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700 mr-1">
            <BadgeCheck size={16} /> eBay連携済み
          </span>
          <a
            href="/api/ebay/connect"
            className="inline-flex items-center min-h-[44px] text-sm font-semibold text-gray-600 border border-gray-300 rounded-xl px-4 active:bg-gray-50"
          >
            再連携する
          </a>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="inline-flex items-center min-h-[44px] text-sm font-semibold text-red-600 border border-red-200 rounded-xl px-4 active:bg-red-50 disabled:opacity-50"
          >
            {disconnecting ? "解除中..." : "連携を解除"}
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <a
            href="/api/ebay/connect"
            className="inline-flex items-center justify-center gap-2 min-h-[44px] text-sm font-bold text-white bg-[#0064D2] rounded-xl px-5 active:bg-[#0053AE]"
          >
            <span className="inline-flex w-5 h-5 bg-white rounded-full items-center justify-center text-[#0064D2] font-black text-[10px]">
              e
            </span>
            eBayアカウントと連携する
          </a>
          <div className="bg-[#F5F7FA] rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              eBayアカウントをお持ちでない方は、先に
              <a
                href="https://signup.ebay.com/pa/crte"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0064D2] font-bold underline mx-0.5"
              >
                eBayアカウントを作成
              </a>
              してから「連携する」を押してください（作成はeBayのページで行います）。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
