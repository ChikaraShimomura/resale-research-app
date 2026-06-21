"use client";
import { useEffect, useState } from "react";
import { UserPlus, X, ShieldCheck, Loader2 } from "lucide-react";

// 身内(master)の指定UI。管理者だけが開ける /admin 内で使う。
// env初期分(COMP_EMAILS)は表示のみ(消せない)、KV管理分は追加/削除できる。
export default function MastersAdmin() {
  const [env, setEnv] = useState<string[]>([]);
  const [managed, setManaged] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = (d: { env?: string[]; managed?: string[] }) => {
    setEnv(d.env ?? []);
    setManaged(d.managed ?? []);
  };

  useEffect(() => {
    fetch("/api/admin/masters")
      .then((r) => r.json())
      .then((d) => { if (d.ok) apply(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const send = async (method: "POST" | "DELETE", email: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/masters", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!d.ok) setErr(d.error || "失敗しました。");
      else { apply(d); if (method === "POST") setInput(""); }
    } catch {
      setErr("通信に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="text-sm font-black text-gray-800 mb-1 flex items-center gap-1.5">
        <ShieldCheck size={15} className="text-[#A98B5C]" /> 身内（無料・無制限）の指定
      </h2>
      <p className="text-[12px] text-gray-500 leading-relaxed mb-3">
        ここに入れたメールのアカウントは、サブスク無しで全機能を無制限に使えます。<b className="text-gray-700">本人がそのメールで登録/ログイン</b>している必要があります。
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (input.trim()) send("POST", input.trim()); }}
        className="flex gap-2 mb-3"
      >
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="family@example.com"
          className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#2D323B] text-white text-[13px] font-bold disabled:opacity-40 active:bg-[#1A1D23]"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} 追加
        </button>
      </form>

      {err && <p className="text-[12px] text-red-600 mb-2">{err}</p>}

      {loading ? (
        <p className="text-[12px] text-gray-400">読み込み中…</p>
      ) : (
        <ul className="space-y-1.5">
          {managed.map((m) => (
            <li key={m} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0 text-[13px] text-gray-800 break-all">{m}</span>
              <button
                onClick={() => send("DELETE", m)}
                disabled={busy}
                aria-label={`${m} を削除`}
                className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-600 active:scale-90 disabled:opacity-40"
              >
                <X size={15} />
              </button>
            </li>
          ))}
          {env.map((m) => (
            <li key={m} className="flex items-center gap-2 bg-gray-50/60 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0 text-[13px] text-gray-500 break-all">{m}</span>
              <span className="text-[10px] text-gray-400 shrink-0">環境変数（固定）</span>
            </li>
          ))}
          {managed.length === 0 && env.length === 0 && (
            <li className="text-[12px] text-gray-400">まだ身内は登録されていません。</li>
          )}
        </ul>
      )}
    </div>
  );
}
