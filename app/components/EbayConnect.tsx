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
  const [loadFailed, setLoadFailed] = useState(false);
  const [flash, setFlash] = useState<"connected" | "error" | "disconnected" | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const [connectHref, setConnectHref] = useState("/api/ebay/connect");

  // 連携状態を取得（失敗時は loadFailed を立てて「準備中」と取り違えない）
  const loadStatus = () => {
    setLoading(true);
    setLoadFailed(false);
    fetch("/api/ebay/status")
      .then((r) => {
        if (!r.ok) throw new Error("status fetch failed");
        return r.json();
      })
      .then((s: Status) => setStatus(s))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    // 出品から来た連携(?list= or storage)を連携リンクに引き継ぐ（OAuth往復で出品対象を失わないため）
    try {
      const list = sp.get("list") || sessionStorage.getItem("ebay_list_after") || localStorage.getItem("ebay_list_after");
      if (list) setConnectHref(`/api/ebay/connect?list=${encodeURIComponent(list)}`);
    } catch {
      /* noop */
    }
    // コールバックからの ?ebay=connected / error を一度だけ表示（?list= は残す）
    const p = sp.get("ebay");
    if (p === "connected" || p === "error") {
      setFlash(p);
      sp.delete("ebay");
      const qs = sp.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setDisconnectFailed(false);
    try {
      const res = await fetch("/api/ebay/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("disconnect failed");
      // 成功時だけ解除済みに更新（失敗時に「解除したつもり」状態を残さない）
      setStatus((s) => (s ? { ...s, connected: false } : s));
      setFlash("disconnected");
      onChange?.(); // 親(セットアップ)へ通知して readiness を再取得し、STEP/準備完了バナーを最新化
    } catch {
      setDisconnectFailed(true);
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
          <AlertTriangle size={16} /> 連携に失敗。もう一度お試しを
        </p>
      )}
      {flash === "disconnected" && (
        <p className="mb-3 text-sm font-bold text-gray-700 bg-gray-50 border border-[#A98B5C]/35 rounded-lg px-3 py-2">
          この端末のeBay連携を解除しました
        </p>
      )}
      {disconnectFailed && (
        <p className="mb-3 text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            <span className="whitespace-nowrap">解除に失敗しました。</span><wbr />
            <span className="whitespace-nowrap">連携はまだ有効です。</span><wbr />
            <span className="whitespace-nowrap">もう一度お試しください</span>
          </span>
        </p>
      )}

      {loading ? (
        <div className="h-11 w-40 bg-gray-100 rounded-xl animate-pulse" />
      ) : loadFailed ? (
        <div className="space-y-2.5">
          <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
            <AlertTriangle size={16} /> 接続状態を取得できませんでした。
          </p>
          <button
            onClick={loadStatus}
            className="inline-flex items-center min-h-[44px] text-sm font-semibold text-gray-600 border border-[#A98B5C]/45 rounded-xl px-4 active:bg-gray-50 focus-visible:ring-2 ring-[#2D323B]/40"
          >
            再読み込み
          </button>
        </div>
      ) : !status?.configured ? (
        <p className="text-sm text-gray-500">
          <span className="whitespace-nowrap">eBay連携は準備中</span><wbr />
          <span className="whitespace-nowrap">（サーバー設定の反映待ち）。</span>
        </p>
      ) : status.connected ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700 mr-1">
            <BadgeCheck size={16} /> eBay連携済み
          </span>
          <a
            href={connectHref}
            className="inline-flex items-center min-h-[44px] text-sm font-semibold text-gray-600 border border-[#A98B5C]/45 rounded-xl px-4 active:bg-gray-50 focus-visible:ring-2 ring-[#2D323B]/40"
          >
            再連携する
          </a>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="inline-flex items-center min-h-[44px] text-sm font-semibold text-red-600 border border-red-200 rounded-xl px-4 active:bg-red-50 disabled:opacity-50 focus-visible:ring-2 ring-[#2D323B]/40"
          >
            {disconnecting ? "解除中..." : "連携を解除"}
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <a
            href={connectHref}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] text-sm font-bold text-white bg-[#0064D2] rounded-xl px-5 active:bg-[#0053AE] focus-visible:ring-2 ring-[#2D323B]/40"
          >
            <span className="inline-flex w-5 h-5 bg-white rounded-full items-center justify-center text-[#0064D2] font-black text-[10px]">
              e
            </span>
            eBayアカウントと連携する
          </a>
          <p className="text-[11px] text-gray-500 leading-relaxed px-1">
            <span className="whitespace-nowrap">押すと<b>eBay公式のログイン画面（英語）</b></span><wbr />
            <span className="whitespace-nowrap">が開きます。</span><wbr />
            <span className="whitespace-nowrap"><b>Agree（同意）</b>でこの画面に戻ります。</span>
          </p>
          <div className="bg-[#F5F7FA] rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <span className="whitespace-nowrap">eBayアカウント未取得なら、</span><wbr />
              <span className="whitespace-nowrap">
                先に
                <a
                  href="https://signup.ebay.com/pa/crte"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#0064D2] font-bold underline mx-0.5"
                >
                  eBayアカウントを作成
                </a>
              </span><wbr />
              <span className="whitespace-nowrap">してから「連携する」を</span><wbr />
              <span className="whitespace-nowrap">（作成はeBayのページで）。</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
