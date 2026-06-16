"use client";
import { useEffect, useState } from "react";
import { supabaseEnabled, createSupabaseBrowserClient } from "../supabase/client";

// 機能ゲート用のログイン判定（クライアント）。
// locked = 認証が有効(env設定済み) かつ 未ログイン のときだけ true。
// Supabase 無効・判定中・取得失敗時は locked=false＝ゲートしない（アプリを壊さない・安全側）。
export function useLoggedIn(): { ready: boolean; loggedIn: boolean; locked: boolean } {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!supabaseEnabled()) {
      setLoggedIn(true); // 認証無効＝ゲートしない
      return;
    }
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => setLoggedIn(!!data.user))
      .catch(() => setLoggedIn(true)); // 失敗時もゲートしない
  }, []);
  return {
    ready: loggedIn !== null,
    loggedIn: !!loggedIn,
    locked: supabaseEnabled() && loggedIn === false,
  };
}
