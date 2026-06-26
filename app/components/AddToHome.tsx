"use client";
import { useEffect, useState } from "react";
import { X, Share, Copy, Check, ExternalLink, Smartphone, Plus } from "lucide-react";
import { canInstallNative, onInstallChange, promptInstall, pwaEnv, type PwaEnv } from "../lib/pwaInstall";

// v2＝旧 v1 の「恒久 dismiss」をリセットして再度促す（ホーム画面追加を徹底して勧める方針）。
const DISMISS_KEY = "a2hs_dismissed_v2";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 閉じても3日後にまた促す。実際に追加(installed)した時だけ恒久的に出さない。

export default function AddToHome() {
  const [env, setEnv] = useState<PwaEnv | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [consentPending, setConsentPending] = useState(true); // Cookie同意が未決の間は出さない（バナー重複回避）
  const [canNative, setCanNative] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnv(pwaEnv());
    setCanNative(canInstallNative());
    // ネイティブプロンプトの取得状況が変わったら再描画（beforeinstallprompt はグローバル捕捉＝pwaInstall）。
    const off = onInstallChange(() => setCanNative(canInstallNative()));

    const syncConsent = () => {
      try {
        setConsentPending(localStorage.getItem("cookie_consent_v1") === null);
      } catch {
        setConsentPending(false);
      }
    };
    try {
      const v = localStorage.getItem(DISMISS_KEY);
      if (v === "installed") setDismissed(true); // 追加済み＝恒久的に出さない
      else if (v && Number(v) > 0) setDismissed(Date.now() - Number(v) < SNOOZE_MS); // 閉じた→3日間だけスヌーズ
      else setDismissed(false);
    } catch {
      setDismissed(false);
    }
    syncConsent();
    window.addEventListener("consent-decided", syncConsent);
    window.addEventListener("storage", syncConsent);
    return () => {
      off();
      window.removeEventListener("consent-decided", syncConsent);
      window.removeEventListener("storage", syncConsent);
    };
  }, []);

  if (!env || dismissed || env.standalone || consentPending) return null;
  // PC等（モバイルでもアプリ内でもない）には出さない
  if (!env.isIOS && !env.isAndroid && !env.inApp) return null;

  const close = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now())); // スヌーズ（3日後にまた促す）
    } catch {
      /* noop */
    }
    setDismissed(true);
  };

  const copyUrl = () => {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  const openInChrome = () => {
    const u = new URL(window.location.href);
    window.location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
  };

  const install = async () => {
    const r = await promptInstall();
    if (r === "accepted") {
      try { localStorage.setItem(DISMISS_KEY, "installed"); } catch { /* noop */ }
      setDismissed(true); // 実際に追加した時だけ恒久的に出さない。キャンセルでは再訪で再表示。
    }
  };

  let title: string;
  let desc: React.ReactNode;
  let actions: React.ReactNode = null;

  if (env.inApp) {
    // アプリ内ブラウザ：まず本物のブラウザで開いてもらう（インストールの前提）
    title = "ブラウザで開くと使いやすいよ";
    desc = env.isIOS
      ? "右上の … →「Safariで開く」。ホーム画面追加が使えるよ。"
      : "右上メニュー →「ブラウザで開く」。または下のボタンから。";
    actions = (
      <div className="flex flex-wrap gap-2 mt-2">
        {env.isAndroid && (
          <button onClick={openInChrome}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#2D323B] rounded-lg px-3 py-1.5 active:bg-[#1A1D23]">
            <ExternalLink size={13} /> Chromeで開く
          </button>
        )}
        <button onClick={copyUrl}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#2D323B] border border-[#2D323B]/30 rounded-lg px-3 py-1.5 active:bg-[#2D323B]/5">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "コピーしました" : "URLをコピー"}
        </button>
      </div>
    );
  } else if (canNative) {
    // Android/Chrome 等：1タップでインストール（最優先＝一番簡単）
    title = "ホーム画面に追加";
    desc = "1タップでアプリのように開く。Xから探さなくてOK。";
    actions = (
      <div className="mt-2">
        <button onClick={install}
          className="inline-flex items-center gap-1.5 text-[13px] font-bold text-white bg-[#2D323B] rounded-lg px-4 py-2 active:bg-[#1A1D23]">
          <Plus size={15} /> ホーム画面に追加
        </button>
      </div>
    );
  } else if (env.isIOS) {
    // iOS はプログラムから追加できない＝手順を視覚的に。
    title = "ホーム画面に追加（かんたん2手）";
    desc = (
      <span className="block space-y-1 mt-0.5">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-[#2D323B] text-white text-[9px] font-black flex items-center justify-center shrink-0">1</span>
          下の<b className="text-gray-700">共有</b><Share size={13} className="inline align-[-2px] text-[#0064D2]" />をタップ
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full bg-[#2D323B] text-white text-[9px] font-black flex items-center justify-center shrink-0">2</span>
          <b className="text-gray-700">「ホーム画面に追加」</b>を選ぶ
        </span>
      </span>
    );
  } else {
    // Android で prompt 未取得：メニューからの追加を案内
    title = "ホーム画面に追加";
    desc = "右上メニュー（⋮）→「ホーム画面に追加」。アプリのようにすぐ開く。";
  }

  return (
    <div
      className="fixed left-3 right-3 z-30 max-w-md mx-auto"
      style={{ bottom: "calc(var(--nav-h, 68px) + env(safe-area-inset-bottom, 0px) + 10px)" }}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-[#A98B5C]/25 p-3.5 flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-[#2D323B] text-white flex items-center justify-center shrink-0">
          <Smartphone size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-gray-900">{title}</p>
          <div className="text-xs text-gray-500 leading-snug mt-0.5">{desc}</div>
          {actions}
        </div>
        <button onClick={close} aria-label="閉じる"
          className="w-7 h-7 -mr-1 -mt-1 flex items-center justify-center text-gray-400 shrink-0 active:scale-90">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
