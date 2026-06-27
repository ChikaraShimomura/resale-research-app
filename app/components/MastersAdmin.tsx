"use client";
import { useEffect, useMemo, useState } from "react";
import { UserPlus, X, ShieldCheck, Loader2, Search, BadgeCheck } from "lucide-react";

interface AdminUser {
  email: string;
  createdAt?: string;
  lastSignInAt?: string;
  isAdmin: boolean;
  isMaster: boolean;
  removable: boolean;
}

// 身内(master)の指定UI。管理者だけが開ける /admin 内で使う。
//  ・手入力で身内に追加
//  ・登録ユーザー一覧（Supabase優先／service_role未設定時はログイン記録のKVフォールバック）を検索して身内をワンタップ指定/解除
export default function MastersAdmin() {
  const [env, setEnv] = useState<string[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [source, setSource] = useState<"supabase" | "kv">("kv");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = (d: { env?: string[]; users?: AdminUser[]; source?: "supabase" | "kv" }) => {
    setEnv(d.env ?? []);
    setUsers(d.users ?? []);
    if (d.source) setSource(d.source);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? users.filter((u) => u.email.includes(q)) : users;
  }, [users, search]);

  // 表示は最大10件（出しすぎ防止）。検索は全件対象なので、超過分は絞り込みで到達できる。
  const LIST_LIMIT = 10;
  const shown = filtered.slice(0, LIST_LIMIT);
  const hiddenCount = filtered.length - shown.length;

  const masters = users.filter((u) => u.isMaster); // env固定＋KV管理（登録済みの身内）

  return (
    <div>
      <h2 className="text-sm font-black text-gray-800 mb-1 flex items-center gap-1.5">
        <ShieldCheck size={15} className="text-[#A98B5C]" /> 身内（無料・無制限）の指定
      </h2>
      <p className="text-[12px] text-gray-500 leading-relaxed mb-3">
        <span className="whitespace-nowrap">ここに入れたメールは</span><wbr />
        <span className="whitespace-nowrap">サブスク無しで全機能を無制限に。</span><wbr />
        <span className="whitespace-nowrap"><b className="text-gray-700">本人がそのメールで登録/ログイン</b></span><wbr />
        <span className="whitespace-nowrap">済みが条件。</span>
      </p>

      {/* 手入力で追加 */}
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

      {/* 現在の身内 */}
      <p className="text-[12px] font-bold text-gray-700 mb-1.5">現在の身内</p>
      {masters.length === 0 && env.length === 0 ? (
        <p className="text-[11px] text-gray-400 mb-3">身内はまだ未登録。</p>
      ) : (
        <ul className="space-y-1.5 mb-4">
          {masters.map((u) => (
            <li key={u.email} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0 text-[13px] text-gray-800 break-all">{u.email}</span>
              {u.removable ? (
                <button onClick={() => send("DELETE", u.email)} disabled={busy} aria-label={`${u.email} を身内から外す`}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-600 active:scale-90 disabled:opacity-40">
                  <X size={15} />
                </button>
              ) : (
                <span className="text-[10px] text-gray-400 shrink-0">{u.isAdmin ? "管理者" : "固定"}</span>
              )}
            </li>
          ))}
          {/* env固定で、まだログインしておらず users に出てこない身内も表示 */}
          {env.filter((e) => !masters.some((m) => m.email === e)).map((e) => (
            <li key={e} className="flex items-center gap-2 bg-gray-50/60 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0 text-[13px] text-gray-500 break-all">{e}</span>
              <span className="text-[10px] text-gray-400 shrink-0">環境変数（固定）</span>
            </li>
          ))}
        </ul>
      )}

      {/* 登録ユーザーを検索して指定 */}
      <div className="pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[12px] font-bold text-gray-700">登録ユーザーから選ぶ</p>
          <span className="text-[10px] text-gray-400">{source === "supabase" ? "全登録ユーザー" : "ログイン記録のみ"}</span>
        </div>

        {source === "kv" && (
          <p className="text-[11px] text-amber-600 mb-2 leading-relaxed">
            <span className="whitespace-nowrap">※ <code className="bg-gray-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code></span><wbr />
            <span className="whitespace-nowrap">未設定のため、</span><wbr />
            <span className="whitespace-nowrap">ログイン済みのみ表示中。</span><wbr />
            <span className="whitespace-nowrap">全登録を出すには</span><wbr />
            <span className="whitespace-nowrap">この環境変数を設定。</span>
          </p>
        )}

        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="メールで検索"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40"
          />
        </div>

        {loading ? (
          <p className="text-[12px] text-gray-400">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-gray-400">{users.length === 0 ? "登録ユーザーがいません。" : "該当するユーザーがいません。"}</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((u) => (
              <li key={u.email} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-800 break-all">{u.email}</p>
                  {u.lastSignInAt && (
                    <p className="text-[10px] text-gray-400">最終ログイン {new Date(u.lastSignInAt).toLocaleDateString("ja-JP")}</p>
                  )}
                </div>
                {u.isAdmin ? (
                  <span className="text-[10px] font-bold text-[#A98B5C] shrink-0">管理者</span>
                ) : u.isMaster ? (
                  u.removable ? (
                    <button onClick={() => send("DELETE", u.email)} disabled={busy}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-gray-300 text-gray-600 text-[11px] font-bold shrink-0 disabled:opacity-40 active:scale-95">
                      身内を解除
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#A98B5C] shrink-0"><BadgeCheck size={11} />身内</span>
                  )
                ) : (
                  <button onClick={() => send("POST", u.email)} disabled={busy}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-full bg-[#2D323B] text-white text-[11px] font-bold shrink-0 disabled:opacity-40 active:scale-95">
                    <UserPlus size={12} /> 身内にする
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {hiddenCount > 0 && (
          <p className="text-[11px] text-gray-400 mt-2">他 {hiddenCount} 件。検索で絞り込み。</p>
        )}
      </div>
    </div>
  );
}
