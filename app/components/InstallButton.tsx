"use client";
import { useEffect, useState } from "react";
import { Share, Copy, Check, ExternalLink, Plus, BadgeCheck } from "lucide-react";
import { canInstallNative, onInstallChange, promptInstall, pwaEnv, type PwaEnv } from "../lib/pwaInstall";

// 設定の常設「ホーム画面に追加」。バナー(AddToHome)を閉じた後でも、ここからいつでも追加できる。
// Android/Chrome等は1タップ、iOSは2手の視覚ガイド、アプリ内ブラウザはブラウザで開く案内、追加済みは完了表示。
export default function InstallButton() {
  const [env, setEnv] = useState<PwaEnv | null>(null);
  const [canNative, setCanNative] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEnv(pwaEnv());
    setCanNative(canInstallNative());
    const off = onInstallChange(() => setCanNative(canInstallNative()));
    return off;
  }, []);

  if (!env) return null;

  const copyUrl = () =>
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  const openInChrome = () => {
    const u = new URL(window.location.href);
    window.location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
  };

  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <li className="flex items-center gap-2 text-[12px] text-gray-700">
      <span className="w-4 h-4 rounded-full bg-[#2D323B] text-white text-[9px] font-black flex items-center justify-center shrink-0">{n}</span>
      {children}
    </li>
  );

  return (
    <div>
      <h2 className="text-sm font-black text-gray-800 mb-1">アプリとして使う（ホーム画面に追加）</h2>

      {env.standalone ? (
        <p className="text-[12px] text-emerald-600 font-bold flex items-center gap-1.5">
          <BadgeCheck size={15} /> 追加済みです。ホーム画面のアイコンから開けます。
        </p>
      ) : env.inApp ? (
        <>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-2">
            いまアプリ内ブラウザで開いています。先にブラウザ（Safari/Chrome）で開くと追加できます。
          </p>
          <div className="flex flex-wrap gap-2">
            {env.isAndroid && (
              <button onClick={openInChrome} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#2D323B] rounded-lg px-3 py-1.5 active:bg-[#1A1D23]">
                <ExternalLink size={13} /> Chromeで開く
              </button>
            )}
            <button onClick={copyUrl} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#2D323B] border border-[#2D323B]/30 rounded-lg px-3 py-1.5 active:bg-[#2D323B]/5">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "コピーしました" : "URLをコピー"}
            </button>
          </div>
        </>
      ) : canNative ? (
        <>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-2">1タップで追加できます。アプリのようにすぐ開けます。</p>
          <button onClick={() => promptInstall()} className="inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-[#2D323B] text-white text-sm font-bold active:bg-[#1A1D23]">
            <Plus size={16} /> ホーム画面に追加
          </button>
        </>
      ) : env.isIOS ? (
        <>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-2">かんたん2手で追加できます：</p>
          <ol className="space-y-1.5">
            <Step n={1}>
              画面下の<b className="text-gray-700">共有</b>
              <Share size={13} className="inline align-[-2px] text-[#0064D2]" />をタップ
            </Step>
            <Step n={2}>
              <b className="text-gray-700">「ホーム画面に追加」</b>を選ぶ
            </Step>
          </ol>
        </>
      ) : (
        <p className="text-[12px] text-gray-500 leading-relaxed">
          ブラウザの右上メニュー（⋮）→「ホーム画面に追加」で、アプリのようにすぐ開けます。
        </p>
      )}
    </div>
  );
}
