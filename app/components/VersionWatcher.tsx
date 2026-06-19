"use client";
import { useEffect, useState } from "react";

// 新しいデプロイを検知したら「更新」ボタンを出す。タップで再読み込み＝新JSへ即切替。
// PWA(ホーム追加)では引っぱり更新が効かず古いJSが残るため、その救済。
// 読み込み時のバージョンを基準に、復帰時・5分ごとに /api/version を見て変化したら表示する。
export default function VersionWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let initial: string | null = null;
    let active = true;

    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { v } = await r.json();
        if (!v || !active) return;
        if (initial === null) initial = v;          // 最初の値を基準に
        else if (v !== initial) setStale(true);     // デプロイが変わった＝古い版で見ている
      } catch {
        /* オフライン等は無視 */
      }
    };

    check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(check, 5 * 60 * 1000); // 5分ごと
    return () => { active = false; document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, []);

  if (!stale) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-20 z-[120] px-3"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[#2D323B] text-white text-[13px] font-bold shadow-lg active:scale-[0.98]"
      >
        ⟳ 新しいバージョンがあります・タップで更新
      </button>
    </div>
  );
}
