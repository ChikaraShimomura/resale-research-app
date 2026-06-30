"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackageCheck, RefreshCw, AlertTriangle, Copy, ExternalLink, Ban, ShoppingBag, Check, Truck } from "lucide-react";
import { toRakutenProductUrl, safeHttpUrl } from "../lib/utils";
import { reportClientError, errToDetail } from "../lib/clientError";

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
  shortageHandledAt?: string; // ⑤ 欠品（仕入れ不可）として記録済み
  cancelled?: boolean; // eBay側でキャンセル＝発送不要
  sourceUrl?: string; // 仕入れ元の直リンク。注文に紐づいて返れば「① 仕入れ先で確認」を出す（無ければ非表示）
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
    } catch (e) {
      reportClientError("ebay_orders_load", { action: "orders_load", endpoint: "/api/ebay/orders", status: 0, detail: `fetch例外: ${errToDetail(e)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  // 「更新」：既存の売却同期(getOrders)を回して注文を取り込み、最新を再表示。
  // 自動同期(タブを開いた時)からも呼ぶので、最終同期時刻を記録してスロットリングできるようにする。
  const SYNC_TS_KEY = "ship_last_sync";
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/ebay/sold", { method: "POST" }).catch((e) => {
        reportClientError("ebay_orders_sync", { action: "orders_sync", endpoint: "/api/ebay/sold", status: 0, detail: `fetch例外: ${errToDetail(e)}` });
      });
      await load();
      try {
        localStorage.setItem(SYNC_TS_KEY, String(Date.now()));
      } catch {
        /* localStorage不可の環境では何もしない */
      }
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    // タブを開いたらまず保存済み注文を即表示し、最終同期からN分以上空いていれば一度だけ自動同期。
    // 手動「更新」を不要にしつつ、開くたびにeBayを叩かない（=連打/レート負荷を避ける）。
    const AUTO_SYNC_MIN_GAP_MS = 10 * 60 * 1000; // 10分
    load();
    let last = 0;
    try {
      last = Number(localStorage.getItem(SYNC_TS_KEY) || 0);
    } catch {
      /* noop */
    }
    if (Date.now() - last >= AUTO_SYNC_MIN_GAP_MS) sync();
    // 初回マウント時のみ。load/sync は useCallback で安定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        発送する注文を見るには eBay と連携を。
      </div>
    );
  }

  const pending = orders.filter((o) => !isShipped(o) && !o.cancelled);
  const shipped = orders.filter((o) => isShipped(o));
  const cancelled = orders.filter((o) => o.cancelled && !isShipped(o)); // eBayでキャンセル済み＝発送不要

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
          <span className="whitespace-nowrap">発送待ちの注文はありません。</span><wbr />
          <span className="whitespace-nowrap">タブを開くと自動で</span><wbr />
          <span className="whitespace-nowrap">最新を取り込みます</span><wbr />
          <span className="whitespace-nowrap">（売れると自動でここに出ます）。</span>
        </p>
      )}

      {/* ④ 新規セラーの売上保留は正常という安心の一言（発送タブを開いた誰にでも見せる） */}
      {(pending.length > 0 || shipped.length > 0) && (
        <div className="flex items-start gap-1.5 rounded-lg bg-[#F5F7FA] border border-[#A98B5C]/25 px-2.5 py-2">
          <span className="text-[12px] shrink-0" aria-hidden="true">💡</span>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            <span className="whitespace-nowrap">新規セラーは</span><wbr />
            <span className="font-bold text-gray-700 whitespace-nowrap">配達確認まで売上が保留</span><wbr />
            <span className="whitespace-nowrap">になりますが、これは正常です。</span><wbr />
            <span className="whitespace-nowrap">実績がつくと入金は早まります。</span>
            <a
              href="https://www.ebay.com/sellercenter/payments-and-fees/getting-paid"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 ml-0.5 font-bold text-[#2D323B] underline whitespace-nowrap"
            >
              受け取り方 <ExternalLink size={10} className="shrink-0" />
            </a>
          </p>
        </div>
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
              {o.trackingNumber &&
                (o.carrier === "JapanPost" || !o.carrier ? (
                  <a
                    href={`https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${encodeURIComponent(o.trackingNumber)}&searchKind=S002&locale=ja`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto font-mono text-[11px] text-[#2D323B] underline shrink-0"
                  >
                    {o.trackingNumber}
                  </a>
                ) : (
                  <span className="ml-auto font-mono text-[11px] text-gray-400 shrink-0">{o.trackingNumber}</span>
                ))}
            </div>
          ))}
        </div>
      )}

      {cancelled.length > 0 && (
        <div className="pt-1 space-y-2">
          <p className="text-[11px] font-bold text-gray-400">キャンセル済み（発送不要）</p>
          {cancelled.map((o) => (
            <div key={o.orderId} className="flex items-center gap-2 text-[12px] text-gray-400 border-t border-gray-100 pt-2">
              <Ban size={14} className="shrink-0" />
              <span className="truncate">{o.lines[0]?.title || o.lines[0]?.sku || o.orderId}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const APOLOGY_MSG =
  "Hello, I'm very sorry, but this item is unexpectedly out of stock and I'm unable to fulfill your order. I'll cancel it for a full refund right away. I sincerely apologize for the inconvenience.";

// Zonos Prepay（関税前払いアプリ・iOS/Android）。米国宛$100超は発送前に関税前払い→13桁IDが必要。
const ZONOS_PREPAY_URL = "https://zonos.com/ja/prepay-app";
// 国際郵便マイページ（日本郵便）。送り状をオンライン作成すると追跡番号が発番される＝それを下の欄に入れる。
const JP_INTL_MYPAGE_URL = "https://www.int-mypage.post.japanpost.jp/mpsp/top.do";
// その注文が「米国宛＆申告額>$100」＝Zonos前払いが要るか。申告額はアプリ出品ラインの売値合計(USD)。
function ddpInfo(o: Order): { needed: boolean; valueUsd: number } {
  const valueUsd = o.lines.reduce((sum, l) => sum + (l.soldUsd || 0), 0);
  return { needed: o.shipTo?.countryCode === "US" && valueUsd > 100, valueUsd };
}

function OrderCard({ order, onShipped }: { order: Order; onShipped: () => void }) {
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("JapanPost");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showRecover, setShowRecover] = useState(false);
  const [shortBusy, setShortBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);

  const badge = dueBadge(order.shipByDate);
  const isShortage = !!order.shortageHandledAt;
  const ebayOrderUrl = `https://www.ebay.com/sh/ord/details?orderid=${encodeURIComponent(order.orderId)}`;
  const ddp = ddpInfo(order); // 米国宛$100超なら関税前払い(Zonos)が要る

  // ① 仕入れ先で確認：注文に紐づく仕入れ元URL（直リンク）。取得できない注文ではボタンを出さない。
  const rakutenUrl = safeHttpUrl(toRakutenProductUrl(order.sourceUrl || ""));
  // ③ 送り状作成→追跡番号取得の導線で貼り付ける宛先テキスト。
  const addr = addressText(order.shipTo);

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

  // ⑤ 欠品として記録（買い手連絡＋eBayキャンセルの導線へ切替）
  const markShortage = async () => {
    setShortBusy(true);
    try {
      await fetch("/api/ebay/orders/shortage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
      }).catch(() => {});
      onShipped(); // 再読込（欠品対応中に切替）
    } finally {
      setShortBusy(false);
    }
  };

  const copyApology = async () => {
    try {
      await navigator.clipboard.writeText(APOLOGY_MSG);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  // ③ 宛先を送り状作成画面に貼り付けやすいようコピー。
  const copyAddress = async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setAddrCopied(true);
      setTimeout(() => setAddrCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  const recoverLinks = (
    <div className="flex flex-wrap items-center gap-1.5">
      <a
        href={ebayOrderUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-700 active:bg-gray-50"
      >
        <ExternalLink size={12} /> eBayでキャンセル
      </a>
      <button
        onClick={copyApology}
        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-700 active:bg-gray-50"
      >
        <Copy size={12} /> {copied ? "コピーした" : "謝罪文をコピー"}
      </button>
    </div>
  );

  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-gray-800 truncate">
            {order.lines[0]?.title || order.lines[0]?.sku || `注文 ${order.orderId}`}
          </p>
          <p className="text-[11px] text-gray-500 truncate">{addressText(order.shipTo) || `買い手: ${order.buyerUsername || "—"}`}</p>
        </div>
        {!isShortage && badge && (
          <span className={`ml-auto shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
        )}
      </div>

      {isShortage ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-2 space-y-1.5">
          <p className="text-[11px] font-bold text-red-700 flex items-center gap-1">
            <Ban size={12} /> 欠品対応中（仕入れ不可）
          </p>
          <p className="text-[10px] text-red-700/90 leading-relaxed">
            <span className="whitespace-nowrap">買い手に連絡→</span><wbr />
            <span className="whitespace-nowrap">eBayで注文をキャンセル</span><wbr />
            <span className="whitespace-nowrap">（理由：在庫切れ）。</span><wbr />
            <span className="whitespace-nowrap">買い手へ全額返金されます。</span>
          </p>
          {recoverLinks}
        </div>
      ) : (
        <>
          {/* ① 仕入れ先で確認。仕入れ元URLが注文に紐づく時だけ出す。 */}
          {rakutenUrl && (
            <a
              href={rakutenUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 h-10 rounded-lg bg-[#2D323B] text-white text-[12px] font-bold active:opacity-90"
            >
              <ShoppingBag size={14} className="shrink-0" /> ① 仕入れ先で確認
              <ExternalLink size={12} className="shrink-0 opacity-80" />
            </a>
          )}

          {/* やること（適応表示）：①仕入れ先で確認→②梱包発送→③追跡登録。米国$100超は②.5でZonos前払いを挟む。 */}
          <p className="text-[10px] text-gray-400 leading-tight">
            <span className="whitespace-nowrap">やること：</span><wbr />
            <span className="whitespace-nowrap">① 仕入れ先で確認 →</span><wbr />
            <span className="whitespace-nowrap">② 梱包・発送 →</span><wbr />
            {ddp.needed && (
              <>
                <span className="whitespace-nowrap">②.5 関税前払い（Zonos）→</span><wbr />
              </>
            )}
            <span className="whitespace-nowrap">③ 追跡番号を登録</span>
          </p>
          {ddp.needed && (
            <a
              href={ZONOS_PREPAY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 active:bg-amber-100"
            >
              <span className="text-[13px] shrink-0">🛃</span>
              <span className="text-[11px] font-bold text-amber-800 leading-tight">
                <span className="whitespace-nowrap">Zonosで関税を前払い</span><wbr />
                <span className="whitespace-nowrap">（米国・申告額 ${Math.round(ddp.valueUsd)}）</span>
                <span className="block font-normal text-amber-700/80">
                  <span className="whitespace-nowrap">前払い→13桁の番号を</span><wbr />
                  <span className="whitespace-nowrap">伝票に記載して発送</span>
                </span>
              </span>
              <ExternalLink size={12} className="ml-auto text-amber-700 shrink-0" />
            </a>
          )}

          {/* ③ 追跡番号の取得導線：国際郵便マイページで送り状を作成すると追跡番号が発番される。
              宛先(addressText)が取れる時だけコピー導線も出す（無ければ送り状作成リンクのみ）。 */}
          <div className="rounded-lg bg-[#F5F7FA] border border-[#A98B5C]/25 p-2 space-y-1.5">
            <p className="text-[10px] text-gray-500 leading-tight">
              <span className="whitespace-nowrap">送り状をオンライン作成すると</span><wbr />
              <span className="whitespace-nowrap">追跡番号がもらえます。</span><wbr />
              <span className="whitespace-nowrap">それを下の欄に入力してください。</span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={JP_INTL_MYPAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-700 active:bg-gray-50"
              >
                <Truck size={12} className="shrink-0" /> 送り状を作成（国際郵便マイページ）
                <ExternalLink size={11} className="shrink-0 text-gray-400" />
              </a>
              {addr && (
                <button
                  type="button"
                  onClick={copyAddress}
                  aria-label="宛先をコピー"
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-700 active:bg-gray-50"
                >
                  {addrCopied ? <Check size={12} className="text-emerald-600 shrink-0" /> : <Copy size={12} className="text-gray-400 shrink-0" />}
                  {addrCopied ? "宛先をコピーした" : "宛先をコピー"}
                </button>
              )}
            </div>
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

          {!showRecover ? (
            <button
              onClick={() => setShowRecover(true)}
              className="text-[10px] text-gray-400 underline active:text-gray-600"
            >
              仕入れできない（欠品）？
            </button>
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-1.5">
              <p className="text-[10px] text-amber-800 leading-relaxed">
                <span className="whitespace-nowrap">仕入れできない時は</span><wbr />
                <span className="whitespace-nowrap">買い手に連絡→</span><wbr />
                <span className="whitespace-nowrap">eBayの注文をキャンセル</span><wbr />
                <span className="whitespace-nowrap">（理由：在庫切れ）。</span><wbr />
                <span className="whitespace-nowrap">下記の導線を利用。</span>
              </p>
              {recoverLinks}
              <button
                onClick={markShortage}
                disabled={shortBusy}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-red-600 text-white text-[11px] font-bold active:opacity-90 disabled:opacity-50"
              >
                {shortBusy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} 欠品として記録
              </button>
            </div>
          )}
        </>
      )}

      {err && (
        <p className="flex items-center gap-1 text-[11px] text-red-600">
          <AlertTriangle size={12} /> {err}
        </p>
      )}
    </div>
  );
}
