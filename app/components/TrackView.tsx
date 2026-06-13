"use client";
import { useEffect } from "react";
import { logEvent } from "../lib/analytics";

// サーバーコンポーネントから「ページ閲覧」のファネルイベントを1回だけ記録するための薄いクライアント。
export default function TrackView({ event }: { event: string }) {
  useEffect(() => { logEvent(event); }, [event]);
  return null;
}
