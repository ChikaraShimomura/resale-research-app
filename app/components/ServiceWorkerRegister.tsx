"use client";
import { useEffect } from "react";

// Service Worker を登録する（オフライン耐性＋プッシュ通知の受け皿）。失敗は無視（非対応ブラウザ等）。
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    // 初期描画を妨げないよう load 後に登録。
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
