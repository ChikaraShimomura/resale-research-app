"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackageCheck, RefreshCw, AlertTriangle } from "lucide-react";

interface Line {
  lineItemId: string;
  sku: string;
  title?: string;
  quantity?: number;
  soldUsd: number;
  shipByDate?: string;
}
interface ShipTo {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
}
interface Order {
  orderId: string;
  creationDate?: string;
  fulfillmentStatus?: string;
  buyerUsername?: string;
  shipTo?: ShipTo;
  shipByDate?: string;
  lines: Line[];
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
}

const isShipped = (o: Order) => !!o.trackingNumber || o.fulfillmentStatus === "FULFILLED";

// 発送期限までの残り日数からバッジ文言/色を作る。期限切れ・当日・近い(2日以内)を強調。
function dueBadge(shipByDate?: string): { label: string; cls: string } | null {
  if (!shipByDate) return null;
  const due = new Date(shipByDate).getTime();
  if (Number.isNaN(due)) return null;
  const days = Math.ceil((due - Date.now()) / 86400000);
  if (days < 0) return { label: `発送期限 ${-days}日超過`, cls: "bg-red-100 text-red-700" };
  if (days === 0) return { label: "発送期限は今日", cls: "bg-red-100 text-red-700" };
  if (days <= 2) return { label: `あと${days}日で発送期限`, cls: "bg-amber-100 text-amber-700" };
  return { label: `発送期限まで${days}日`, cls: "bg-gray-100 text-gray-600" };
}

function addressText(s?: ShipTo): string {
  if (!s) return "";
  return [s.name, [s.postalCode, s.city, s.stateOrProvince].filter(Boolean).join(" "), s.addressLine1, s.addressLine2, s.countryCode]
    .filter(Boolean)
    .join(" / ");
}

export default function ShipOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ebay/orders", { cache: "no-store" });
      const d = await r.json();
      setConnected(d.connected !== false);
      setOrders(Array.isArray(d.orders) ? d.orders : []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);

  // 「更新」：既存の売却同期(getOrders)を回して注文を取り込み、最新を再表示。
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/ebay/sold", { method: "POST" }).catch(() => {});
      await load();
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm flex items-center justify-center gap-2 text-[12px] text-gray-500">
        <Loader2 size={15} className="animate-spin" /> 注文を読み込み中…
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm text-[12px] text-gray-600">
        発送する注文を表示するには、eBay と連携してください。
      </div>
    );
  }

  const pending = orders.filter((o) => !isShipped(o));
  const shipped = orders.filter((o) => isShipped(o));

  return (
    <div className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-black text-gray-800">発送する注文（追跡番号を登録）</p>
        <button
          onClick={sync}
          disabled={syncing}
          className="ml-auto flex items-center gap-1 text-[11px] font-bold text-gray-500 active:text-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> 更新
        </button>
      </div>

      {pending.length === 0 && shipped.length === 0 && (
        <p className="text-[12px] text-gray-500 leading-relaxed">
          まだ発送待ちの注文はありません。売れると自動でここに出ます（「更新」で最新を取り込み）。
        </p>
      )}

      {pending.map((o) => (
        <OrderCard key={o.orderId} order={o} onShipped={load} />
      ))}

      {shipped.length > 0 && (
        <div className="pt-1 space-y-2">
          <p className="text-[11px] font-bold text-gray-400">発送済み</p>
          {shipped.map((o) => (
            <div key={o.orderId} className="flex items-center gap-2 text-[12px] text-gray-500 border-t border-gray-100 pt-2">
              <PackageCheck size={14} className="text-green-600 shrink-0" />
              <span className="truncate">{o.lines[0]?.title || o.lines[0]?.sku || o.orderId}</span>
              {o.trackingNumber && <span className="ml-auto font-mono text-[11px] text-gray-400 shrink-0">{o.trackingNumber}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, onShipped }: { order: Order; onShipped: () => void }) {
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("JapanPost");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const badge = dueBadge(order.shipByDate);

  const submit = async () => {
    const t = tracking.trim();
    if (!t) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/ebay/orders/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, trackingNumber: t, carrier }),
      });
      const d = await r.json();
      if (!d.ok) {
        setErr(d.error || "登録に失敗しました。");
        return;
      }
      onShipped(); // 親が再読込（発送済みへ移動）
    } catch {
      setErr("通信エラーが発生しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-gray-800 truncate">
            {order.lines[0]?.title || order.lines[0]?.sku || `注文 ${order.orderId}`}
          </p>
          <p className="text-[11px] text-gray-500 truncate">{addressText(order.shipTo) || `買い手: ${order.buyerUsername || "—"}`}</p>
        </div>
        {badge && <span className={`ml-auto shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder="追跡番号"
          inputMode="text"
          className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-gray-200 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40"
        />
        <select
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          className="h-9 px-1.5 rounded-lg border border-gray-200 text-[11px] text-gray-600 bg-white"
        >
          <option value="JapanPost">日本郵便</option>
          <option value="Other">その他</option>
        </select>
        <button
          onClick={submit}
          disabled={busy || !tracking.trim()}
          className="h-9 px-3 rounded-lg bg-[#2D323B] text-white text-[12px] font-bold active:opacity-90 disabled:opacity-40 shrink-0 flex items-center gap-1"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} 登録
        </button>
      </div>

      {err && (
        <p className="flex items-center gap-1 text-[11px] text-red-600">
          <AlertTriangle size={12} /> {err}
        </p>
      )}
    </div>
  );
}
