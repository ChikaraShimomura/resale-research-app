"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseEnabled, createSupabaseBrowserClient } from "../lib/supabase/client";

// 「育てた価値をログインで守る」損失回避ナッジ。
// 表示条件：Supabase有効（=認証が動く環境）かつ 未ログイン のときだけ。匿名の入口は壊さない。
// from= はファネル帰属（/login?from=... → サインイン成功時に signup_from_* を計上）。
// once を渡すと、その localStorage キーで「1回だけ・×で閉じれる」チップになる（出品成功などの“勝ちの瞬間”用）。
// once 無しは常設バナー（成績ダッシュボードなど、成果がある間ずっと表示）。
export default function SaveProgressNudge({
  from,
  message,
  once,
}: {
  from: "dashboard" | "listing" | "sold" | "connect";
  message: string;
  once?: string;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!supabaseEnabled()) return; // 認証無効なら出さない（非破壊）
    try {
      if (once && localStorage.getItem(once) === "1") return; // 既に閉じた/見た
    } catch {
      /* noop */
    }
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!data.user) setShow(true); // 未ログインのときだけ
      })
      .catch(() => {});
  }, [once]);

  if (!show) return null;

  const markSeen = () => {
    try {
      if (once) localStorage.setItem(once, "1");
    } catch {
      /* noop */
    }
  };

  return (
    <div className="flex items-start gap-2 bg-[#FFF7ED] border border-amber-200 rounded-xl px-3.5 py-2.5">
      <Link
        href={`/login?from=${from}`}
        onClick={markSeen}
        className="flex-1 text-[12px] text-amber-900 leading-relaxed active:opacity-70"
      >
        {message}
      </Link>
      {once && (
        <button
          onClick={() => {
            markSeen();
            setShow(false);
          }}
          aria-label="閉じる"
          className="shrink-0 text-amber-400 text-[13px] leading-none px-1 py-0.5"
        >
          ✕
        </button>
      )}
    </div>
  );
}
