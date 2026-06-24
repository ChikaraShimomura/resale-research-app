"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

// 通知のオン/オフ＋受け取る種類を本人が選べる設定UI。VAPID公開鍵はビルド時に埋め込まれる。
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type Prefs = { sold: boolean; newdeal: boolean; weekly: boolean };
const DEFAULT: Prefs = { sold: true, newdeal: true, weekly: true };
const LABELS: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: "sold", label: "売れたとき", desc: "自分のeBay出品の売却（かも）を検知して通知" },
  { key: "newdeal", label: "新着の高利益商品", desc: "高利益率の新着を通知" },
  { key: "weekly", label: "週1のまとめ", desc: "成績・新着のダイジェストを週1通知" },
];

export default function PushSettings() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      !!VAPID_PUBLIC;
    setSupported(ok);
    if (!ok) return;
    if (Notification.permission === "denied") setDenied(true);
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setEnabled(true);
          const j = await fetch("/api/push/subscribe", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
          if (j?.prefs) setPrefs(j.prefs);
        }
      } catch {
        /* noop */
      }
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setDenied(perm === "denied"); setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource });
      const json = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: sub.endpoint, keys: json.keys }, prefs }),
      });
      setEnabled(true);
    } catch {
      /* noop */
    }
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
    } catch {
      /* noop */
    }
    setBusy(false);
  };

  const toggle = async (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "prefs", endpoint: sub.endpoint, prefs: next }),
        }).catch(() => {});
      }
    } catch {
      /* noop */
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Bell size={18} className="text-[#2D323B]" />
        <h2 className="text-[14px] font-black text-gray-800">通知</h2>
      </div>

      {!supported ? (
        <p className="text-[12px] text-gray-400 leading-relaxed">
          この端末/ブラウザはプッシュ通知に非対応。iPhoneは「ホーム画面に追加」後に対応。
        </p>
      ) : !enabled ? (
        <>
          <p className="text-[12px] text-gray-500 mb-3 leading-relaxed">
            出品の売却・新着の高利益商品などをお知らせ。いつでもオフ可。
          </p>
          {denied && (
            <p className="text-[11px] text-[#2D323B] mb-2 leading-relaxed">
              通知がブロック中。端末の設定でこのサイトの通知を許可してください。
            </p>
          )}
          <button
            onClick={enable}
            disabled={busy || denied}
            className="h-11 px-5 rounded-xl bg-[#2D323B] text-white font-bold text-sm disabled:opacity-40 active:scale-[0.99]"
          >
            {busy ? "設定中…" : "通知をオンにする"}
          </button>
        </>
      ) : (
        <>
          <p className="text-[12px] text-gray-500 mb-2">受け取る通知を選択。</p>
          <ul className="divide-y divide-gray-100">
            {LABELS.map((l) => (
              <li key={l.key} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-gray-800">{l.label}</p>
                  <p className="text-[11px] text-gray-400 leading-snug">{l.desc}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={prefs[l.key]}
                  aria-label={l.label}
                  onClick={() => toggle(l.key)}
                  className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${prefs[l.key] ? "bg-[#2D323B]" : "bg-gray-300"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${prefs[l.key] ? "translate-x-5" : ""}`} />
                </button>
              </li>
            ))}
          </ul>
          <button onClick={disable} disabled={busy} className="mt-3 text-[12px] font-bold text-gray-500 underline underline-offset-2 disabled:opacity-40">
            {busy ? "処理中…" : "通知をオフにする"}
          </button>
        </>
      )}
    </div>
  );
}
