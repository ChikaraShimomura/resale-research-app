"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// チーム招待の承認ボタン。POST /api/team/accept → 成功で /team へ。
export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).then((r) => r.json());
      if (res.ok) {
        router.push("/team");
      } else {
        setErr(res.error || "承認に失敗しました。");
        setBusy(false);
      }
    } catch {
      setErr("通信エラーで承認できませんでした。");
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={accept}
        disabled={busy}
        className="inline-flex items-center justify-center h-11 px-8 bg-[#2D323B] text-white font-bold text-sm rounded-xl disabled:opacity-40 active:bg-[#1A1D23]"
      >
        {busy ? "承認中…" : "招待を承認する"}
      </button>
      {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
    </div>
  );
}
