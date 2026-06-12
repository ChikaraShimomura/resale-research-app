"use client";
import { useEffect, useState } from "react";
import { X, Share, Copy, Check, ExternalLink, Smartphone } from "lucide-react";

const DISMISS_KEY = "a2hs_dismissed_v1";

interface Env {
  isIOS: boolean;
  isAndroid: boolean;
  inApp: boolean;
  standalone: boolean;
}

// beforeinstallprompt は型が標準化されていないので最小限の形で扱う
type InstallEvent = Event & { prompt: () => void; userChoice: Promise<unknown> };

export default function AddToHome() {
  const [env, setEnv] = useState<Env | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    // 主要なアプリ内ブラウザ（X/Twitter, Facebook, Instagram, LINE, TikTok 等）
    const inApp = /Twitter|FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|musical_ly/i.test(ua);
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setEnv({ isIOS, isAndroid, inApp, standalone });
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!env || dismissed || env.standalone) return null;
  // PC等（モバイルでもアプリ内でもない）には出さない
  if (!env.isIOS && !env.isAndroid && !env.inApp) return null;

  const close = () => {
    localStorage.setItem(DISMISS_KEY, "1");
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
    // Android のアプリ内ブラウザから Chrome へ抜ける intent URL
    window.location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    close();
  };

  let title: string;
  let desc: React.ReactNode;
  let actions: React.ReactNode = null;

  if (env.inApp) {
    // アプリ内ブラウザ：まず本物のブラウザで開いてもらう（アプリ起動・ホーム追加の前提）
    title = "ブラウザで開くと使いやすいよ";
    desc = env.isIOS
      ? "右上の … →「ブラウザ（Safari）で開く」を選んでね。仕入れアプリの起動やホーム画面追加が使えるようになるよ。"
      : "右上メニュー →「ブラウザで開く」を選んでね。または下のボタンからどうぞ。";
    actions = (
      <div className="flex flex-wrap gap-2 mt-2">
        {env.isAndroid && (
          <button onClick={openInChrome}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#BF0000] rounded-lg px-3 py-1.5 active:bg-[#9E0000]">
            <ExternalLink size={13} /> Chromeで開く
          </button>
        )}
        <button onClick={copyUrl}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#BF0000] border border-[#BF0000]/30 rounded-lg px-3 py-1.5 active:bg-[#BF0000]/5">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "コピーしました" : "URLをコピー"}
        </button>
      </div>
    );
  } else if (env.isAndroid && deferred) {
    // Android で install プロンプトが取れた場合は1タップ追加
    title = "ホーム画面に追加";
    desc = "アプリのように1タップで開けるよ。Xから何度も探さなくてOK。";
    actions = (
      <div className="mt-2">
        <button onClick={install}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#BF0000] rounded-lg px-3 py-1.5 active:bg-[#9E0000]">
          <Smartphone size={13} /> ホーム画面に追加
        </button>
      </div>
    );
  } else if (env.isIOS) {
    title = "ホーム画面に追加";
    desc = (
      <>
        画面下の共有ボタン <Share size={13} className="inline align-[-2px]" /> →「ホーム画面に追加」で、アプリのようにすぐ開けるよ。
      </>
    );
  } else {
    // Android で prompt 未取得：メニューからの追加を案内
    title = "ホーム画面に追加";
    desc = "右上メニュー →「ホーム画面に追加」で、アプリのようにすぐ開けるよ。";
  }

  return (
    <div
      className="fixed left-3 right-3 z-30 max-w-md mx-auto"
      style={{ bottom: "calc(var(--nav-h, 68px) + env(safe-area-inset-bottom, 0px) + 10px)" }}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-3.5 flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-[#BF0000] text-white flex items-center justify-center shrink-0">
          <Smartphone size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 leading-snug mt-0.5">{desc}</p>
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
