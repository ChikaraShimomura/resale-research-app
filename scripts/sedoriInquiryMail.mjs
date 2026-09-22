// せどり帳のお問い合わせ即時メール(2.2.0〜)。30分ごとに Supabase の inquiries を見て、未通知の分を送る。
//   - kind='business' → 件名「【せどり帳】お仕事・コラボのご相談 N件」
//   - kind='feedback' → 件名「【せどり帳】届いた声 N件」(2.1.0 以前の要望は sedoriFeedbackMail.mjs が PostHog から送る)
//   - 読み取りは RPC(inquiries_pending / inquiries_mark_notified)とトークンだけ。service_role は使わない。
//     定義は sedori-ledger/supabase/patch-inquiries.sql。
//   - 送信に成功した分だけ通知済みにする(先に立てると、失敗した相談が永久に埋もれる)。
//   - env: SEDORI_SUPABASE_URL / SEDORI_SUPABASE_ANON_KEY / SEDORI_INQUIRY_TOKEN / RESEND_API_KEY / MAIL_TO(任意)
//   - 手動: node scripts/sedoriInquiryMail.mjs --dry   (送らずに件数だけ表示)
//
// 🔴 このリポジトリは公開。相談の本文・会社名・名前・連絡先をログに出さない(--dry でも件数だけ)。
// 🔴 fail-quiet にしない。鍵が無ければ即エラー終了する(workflow 側で「トークン未設定なら実行しない」を分けている)。

const SB_URL = process.env.SEDORI_SUPABASE_URL || "";
const SB_ANON = process.env.SEDORI_SUPABASE_ANON_KEY || "";
const TOKEN = process.env.SEDORI_INQUIRY_TOKEN || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 お問い合わせ <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry");

const ACCENT = "#3D5166";
const MUTED = "#8A8F98";
const LINE = "#E6E8EC";
/** 1通に入れる上限。超えた分は次の回に回す */
const PER_MAIL = 20;

const missing = [];
if (!SB_URL) missing.push("SEDORI_SUPABASE_URL");
if (!SB_ANON) missing.push("SEDORI_SUPABASE_ANON_KEY");
if (!TOKEN) missing.push("SEDORI_INQUIRY_TOKEN");
if (!DRY && !RESEND_API_KEY) missing.push("RESEND_API_KEY");
if (missing.length) {
  console.error(`環境変数が足りません: ${missing.join(", ")}`);
  process.exit(1);
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const jst = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? "");
  const j = new Date(d.getTime() + 9 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
};

async function rpc(name, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SB_ANON,
      Authorization: `Bearer ${SB_ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  // エラー本文に相談内容は入らない(関数の例外文だけ)が、念のため先頭だけ
  if (!r.ok) throw new Error(`Supabase ${name} ${r.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

const mailtoReply = (to, subject) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}`;

function businessCard(q) {
  return `
  <div style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px;margin:0 0 12px">
    <div style="font-size:13px;color:#1C2733;margin-bottom:6px">
      <b>${esc(q.name)}</b>${q.company ? ` ・ ${esc(q.company)}` : ""}
      ・ <a href="${mailtoReply(q.contact, "Re: せどり帳へのご相談")}" style="color:${ACCENT}">${esc(q.contact)}</a>
    </div>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#1C2733">${esc(q.body)}</div>
    <div style="margin-top:10px;font-size:12px;color:${MUTED}">
      ${esc(jst(q.created_at))} JST ・ v${esc(q.app_version) || "?"} ・ ${esc(q.platform) || "?"} ・ ${esc(q.lang) || "?"}
    </div>
  </div>`;
}

function feedbackCard(q) {
  const contact = q.contact
    ? `<a href="${mailtoReply(q.contact, "Re: せどり帳へのご要望")}" style="color:${ACCENT}">${esc(q.contact)}</a>`
    : `<span style="color:${MUTED}">連絡先なし(返信不可)</span>`;
  return `
  <div style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px;margin:0 0 12px">
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#1C2733">${esc(q.body)}</div>
    <div style="margin-top:10px;font-size:12px;color:${MUTED}">
      ${esc(jst(q.created_at))} JST ・ v${esc(q.app_version) || "?"} ・ ${esc(q.platform) || "?"} ・ ${contact}
    </div>
  </div>`;
}

function page(title, lead, cards, foot) {
  return `<!doctype html><html><body style="margin:0;padding:20px;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;padding:22px">
    <h2 style="margin:0 0 4px;font-size:16px;color:${ACCENT}">${esc(title)}</h2>
    <p style="margin:0 0 16px;font-size:12px;color:${MUTED}">${esc(lead)}</p>
    ${cards}
    <p style="margin:18px 0 0;font-size:11px;color:${MUTED}">${esc(foot)}</p>
  </div></body></html>`;
}

async function send(subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.id || "";
}

async function main() {
  const rows = (await rpc("inquiries_pending", { p_token: TOKEN })) || [];
  const business = rows.filter((q) => q.kind === "business").slice(0, PER_MAIL);
  const feedback = rows.filter((q) => q.kind === "feedback").slice(0, PER_MAIL);
  console.log(`pending: business ${business.length} / feedback ${feedback.length}`);
  if (DRY) return;

  let failed = false;
  if (business.length) {
    try {
      const subject = `【せどり帳】お仕事・コラボのご相談 ${business.length}件`;
      const html = page(
        `お仕事・コラボのご相談 ${business.length}件`,
        "アプリの設定「お仕事・コラボのご相談」から届きました。メールアドレスを押すと返信できます。",
        business.map(businessCard).join(""),
        "30分ごとに確認して、新しいものだけ送っています。削除の依頼があれば Supabase の inquiries から消してください。"
      );
      console.log("sent business:", await send(subject, html));
      const n = await rpc("inquiries_mark_notified", { p_token: TOKEN, p_ids: business.map((q) => q.id) });
      console.log("marked:", n);
    } catch (e) {
      failed = true;
      console.error(String(e.message || e).slice(0, 200));
    }
  }
  if (feedback.length) {
    try {
      const subject =
        feedback.length === 1
          ? `【せどり帳】届いた声 1件: ${String(feedback[0].body).replace(/\s+/g, " ").slice(0, 24)}`
          : `【せどり帳】届いた声 ${feedback.length}件`;
      const html = page(
        `せどり帳に届いた声 ${feedback.length}件`,
        "アプリの「運営への要望を送る」から届いたものです。連絡先があれば直接返信できます。",
        feedback.map(feedbackCard).join(""),
        "30分ごとに確認して、新しいものだけ送っています。まとめの数字は月曜の週次レポートで。"
      );
      console.log("sent feedback:", await send(subject, html));
      const n = await rpc("inquiries_mark_notified", { p_token: TOKEN, p_ids: feedback.map((q) => q.id) });
      console.log("marked:", n);
    } catch (e) {
      failed = true;
      console.error(String(e.message || e).slice(0, 200));
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(String(e.message || e).slice(0, 200));
  process.exit(1);
});
