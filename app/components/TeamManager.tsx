"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, Trash2, ArrowRight, Mail, Users } from "lucide-react";

type RosterMember = { actor: string; email: string };
type Pending = { email: string; token: string };
type TeamRef = { ownerActor: string; ownerEmail: string; name?: string };

export default function TeamManager({
  roster,
  pending,
  myTeams,
  teamName,
}: {
  roster: RosterMember[];
  pending: Pending[];
  myTeams: TeamRef[];
  teamName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(teamName);
  const [nameSaved, setNameSaved] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "warn" | "err"; text: string } | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [actBusy, setActBusy] = useState<string | null>(null);

  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setBusy(true);
    setMsg(null);
    setInviteLink(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      }).then((r) => r.json());
      if (res.ok && res.sent) {
        setMsg({
          type: "ok",
          text: res.unverified
            ? `${e} に招待リンクを送りました。会員確認は相手の承認時に行われます（会員でなければ承認できません）。`
            : `${e} に招待リンクを送りました。相手が承認すると共有されます。`,
        });
        setEmail("");
        router.refresh();
      } else if (res.ok && res.emailOff) {
        // メール送信が未設定の環境。承認リンクを表示してオーナーが手動で渡せるようにする。
        setMsg({ type: "warn", text: `メール送信が未設定のため、下の承認リンクを ${e} さんに直接共有してください。` });
        setInviteLink(res.inviteUrl || null);
        setEmail("");
        router.refresh();
      } else if (res.ok && res.notMember) {
        setMsg({ type: "warn", text: `${e} はまだ会員ではありません。先に会員登録してもらってください。` });
      } else {
        setMsg({ type: "err", text: res.error || "招待に失敗しました。" });
      }
    } catch {
      setMsg({ type: "err", text: "通信エラーで招待できませんでした。" });
    }
    setBusy(false);
  };

  const act = async (body: Record<string, string>, key: string) => {
    setActBusy(key);
    try {
      const res = await fetch("/api/team/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.ok) router.refresh();
    } catch { /* noop */ }
    setActBusy(null);
  };

  const saveName = async () => {
    try {
      const res = await fetch("/api/team/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-name", name: name.trim() }),
      }).then((r) => r.json());
      if (res.ok) { setNameSaved(true); setTimeout(() => setNameSaved(false), 1500); router.refresh(); }
    } catch { /* noop */ }
  };

  return (
    <div className="space-y-5">
      {/* チーム名（任意・オーナーが設定） */}
      <section className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
        <h2 className="text-sm font-black text-gray-800 mb-2">チーム名</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="例：副業チーム"
            className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-[#A98B5C]/40 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40"
          />
          <button onClick={saveName} className="shrink-0 h-10 px-4 rounded-xl bg-[#2D323B] text-white text-[13px] font-bold active:bg-[#1A1D23]">
            保存
          </button>
        </div>
        {nameSaved && <p className="mt-1 text-[12px] font-bold text-emerald-600">保存しました。</p>}
      </section>

      {/* 招待＝あなたのデータを共有する相手を追加 */}
      <section className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus size={16} className="text-[#2D323B]" />
          <h2 className="text-sm font-black text-gray-800">メンバーを招待</h2>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
          会員のメールを指定すると承認リンクを送ります。承認した相手は、あなたの<b>「仕入れた商品」と収支（仕入れ額・売上額）</b>を見られます。
        </p>
        <div className="flex gap-2">
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="member@example.com"
            className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-[#A98B5C]/40 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#A98B5C]/40"
          />
          <button
            onClick={invite}
            disabled={busy || !email.trim()}
            className="shrink-0 h-10 px-4 rounded-xl bg-[#2D323B] text-white text-[13px] font-bold disabled:opacity-40 active:bg-[#1A1D23]"
          >
            {busy ? "確認中…" : "招待"}
          </button>
        </div>
        {msg && (
          <p
            className={`mt-2 text-[12px] leading-relaxed ${
              msg.type === "ok" ? "text-emerald-700" : msg.type === "warn" ? "text-amber-700" : "text-rose-600"
            }`}
          >
            {msg.text}
          </p>
        )}
        {inviteLink && (
          <input
            readOnly
            value={inviteLink}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full h-9 px-2.5 rounded-lg border border-[#A98B5C]/40 bg-gray-50 text-[11px] text-gray-600 font-mono"
          />
        )}
      </section>

      {/* 保留中の招待 */}
      {pending.length > 0 && (
        <section className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
          <h2 className="text-[13px] font-black text-gray-800 mb-2">承認待ち（{pending.length}）</h2>
          <ul className="space-y-1.5">
            {pending.map((p) => (
              <li key={p.email} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-gray-600 inline-flex items-center gap-1.5 min-w-0">
                  <Mail size={13} className="text-gray-400 shrink-0" /> <span className="truncate">{p.email}</span>
                </span>
                <button
                  onClick={() => act({ action: "cancel-invite", email: p.email }, `cancel:${p.email}`)}
                  disabled={actBusy === `cancel:${p.email}`}
                  className="shrink-0 text-[11px] font-bold text-gray-400 disabled:opacity-40"
                >
                  取消
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* あなたのチーム（共有相手） */}
      <section className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
        <h2 className="text-[13px] font-black text-gray-800 mb-2">あなたが共有しているメンバー（{roster.length}）</h2>
        {roster.length === 0 ? (
          <p className="text-[12px] text-gray-400 leading-relaxed">まだいません。上の招待からメンバーを追加できます。</p>
        ) : (
          <ul className="space-y-1.5">
            {roster.map((m) => (
              <li key={m.actor} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-gray-700 inline-flex items-center gap-1.5 min-w-0">
                  <Users size={13} className="text-gray-400 shrink-0" /> <span className="truncate">{m.email}</span>
                </span>
                <button
                  onClick={() => act({ action: "remove-member", memberActor: m.actor }, `rm:${m.actor}`)}
                  disabled={actBusy === `rm:${m.actor}`}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-rose-500 disabled:opacity-40"
                >
                  <Trash2 size={12} /> 外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 参加中のチーム（他の人のデータを見られる） */}
      <section className="bg-white border border-[#A98B5C]/25 rounded-2xl p-4 shadow-sm">
        <h2 className="text-[13px] font-black text-gray-800 mb-2">参加中のチーム（{myTeams.length}）</h2>
        {myTeams.length === 0 ? (
          <p className="text-[12px] text-gray-400 leading-relaxed">招待されたチームはまだありません。承認するとここに出ます。</p>
        ) : (
          <ul className="space-y-2">
            {myTeams.map((t) => (
              <li key={t.ownerActor}>
                <Link
                  href={`/team/${encodeURIComponent(t.ownerActor)}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#A98B5C]/25 px-3 py-2.5 active:bg-gray-50"
                >
                  <span className="text-[12px] font-bold text-gray-800 min-w-0 truncate">{t.name || `${t.ownerEmail} のチーム`}</span>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-bold text-[#2D323B]">
                    見る <ArrowRight size={14} />
                  </span>
                </Link>
                <div className="mt-1 text-right">
                  <button
                    onClick={() => act({ action: "leave", ownerActor: t.ownerActor }, `leave:${t.ownerActor}`)}
                    disabled={actBusy === `leave:${t.ownerActor}`}
                    className="text-[11px] font-bold text-gray-400 disabled:opacity-40"
                  >
                    このチームから抜ける
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
