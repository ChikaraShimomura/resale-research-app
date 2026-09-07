// せどり帳「届いた声」即時メール。30分ごとに PostHog を見て、新しい feedback を届いた順にメールする。
//   - 週次レポート(月曜9時)は「まとめ」。こちらは不具合連絡・要望を寝かせないための即時通知。
//   - 重複送信ガードは KV(`sedori_fb_sent:{uuid}`・TTL 60日)。イベントUUID単位なので、
//     実行が重なっても・時計がずれても二重に送らない。
//   - env: POSTHOG_API_KEY / RESEND_API_KEY / KV_REST_API_URL / KV_REST_API_TOKEN / MAIL_TO(任意) / MAIL_FROM(任意)
//   - 手動: node scripts/sedoriFeedbackMail.mjs --dry       (送らずに中身だけ表示)
//           node scripts/sedoriFeedbackMail.mjs --hours 168 (遡る時間・既定24)
//
// 🔴 fail-quiet にしない。鍵が無ければ即エラー終了する(2026-08-12 の欠配は
//    「鍵が無ければ静かに正常終了」が Vercel 側の入れ忘れを隠したのが原因)。

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 届いた声 <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

const DRY = process.argv.includes("--dry");
const hoursArg = process.argv.indexOf("--hours");
const HOURS = hoursArg >= 0 ? Number(process.argv[hoursArg + 1]) || 24 : 24;

const PH_HOST = "https://us.posthog.com";
const PH_PROJECT = 538873;
const SENT_KEY = (uuid) => `sedori_fb_sent:${uuid}`;
const SENT_TTL = 60 * 24 * 60 * 60;

const ACCENT = "#3D5166";
const MUTED = "#8A8F98";
const LINE = "#E6E8EC";

const missing = [];
if (!POSTHOG_API_KEY) missing.push("POSTHOG_API_KEY");
if (!DRY && !RESEND_API_KEY) missing.push("RESEND_API_KEY");
if (!DRY && !(KV_URL && KV_TOKEN)) missing.push("KV_REST_API_URL / KV_REST_API_TOKEN");
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

async function hogql(query) {
  const r = await fetch(`${PH_HOST}/api/environments/${PH_PROJECT}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PostHog ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.results || [];
}

async function kvCmd(cmd) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`KV ${cmd[0]} ${r.status}`);
  return (await r.json()).result;
}

function card(f) {
  const contact = f.contact
    ? `<a href="mailto:${esc(f.contact)}" style="color:${ACCENT}">${esc(f.contact)}</a>`
    : `<span style="color:${MUTED}">連絡先なし(返信不可)</span>`;
  return `
  <div style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px;margin:0 0 12px">
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#1C2733">${esc(f.message) || "(本文なし)"}</div>
    <div style="margin-top:10px;font-size:12px;color:${MUTED}">
      ${esc(jst(f.timestamp))} JST ・ v${esc(f.version) || "?"} ・ ${contact}
    </div>
  </div>`;
}

async function main() {
  // uuid で重複を除く。properties は文字列で返るので coalesce で空文字に寄せる
  const rows = await hogql(
    `select uuid, timestamp, properties.message, properties.contact, properties.version
       from events
      where event = 'feedback' and timestamp >= now() - interval ${Math.max(1, Math.round(HOURS))} hour
      order by timestamp asc
      limit 100`
  );
  const all = rows.map((r) => ({
    uuid: String(r[0] ?? ""),
    timestamp: r[1],
    message: r[2] ?? "",
    contact: r[3] ?? "",
    version: r[4] ?? "",
  }));
  console.log(`feedback in last ${HOURS}h: ${all.length}`);
  if (!all.length) return;

  // 送信済みを除く(KVが無い=--dry のときは全部を対象に見せるだけ)
  let fresh = all;
  if (KV_URL && KV_TOKEN) {
    const flags = await Promise.all(all.map((f) => kvCmd(["GET", SENT_KEY(f.uuid)]).catch(() => null)));
    fresh = all.filter((_, i) => !flags[i]);
  }
  console.log(`new: ${fresh.length}`);
  if (!fresh.length) return;

  const subject =
    fresh.length === 1
      ? `【せどり帳】届いた声 1件: ${String(fresh[0].message).replace(/\s+/g, " ").slice(0, 24)}`
      : `【せどり帳】届いた声 ${fresh.length}件`;
  const html = `<!doctype html><html><body style="margin:0;padding:20px;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;padding:22px">
    <h2 style="margin:0 0 4px;font-size:16px;color:${ACCENT}">せどり帳に届いた声 ${fresh.length}件</h2>
    <p style="margin:0 0 16px;font-size:12px;color:${MUTED}">アプリの「ご要望・不具合の報告」から届いたものです。連絡先があれば直接返信できます。</p>
    ${fresh.map(card).join("")}
    <p style="margin:18px 0 0;font-size:11px;color:${MUTED}">30分ごとに確認して、新しいものだけ送っています。まとめの数字は月曜の週次レポートで。</p>
  </div></body></html>`;

  if (DRY) {
    console.log("=== DRY RUN ===");
    console.log("subject:", subject);
    console.log(fresh.map((f) => `- ${jst(f.timestamp)} v${f.version} ${f.contact || "-"}: ${f.message}`).join("\n"));
    return;
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  console.log("sent:", j.id || JSON.stringify(j));

  // 送信できたものだけ既読にする(送信前に立てると、失敗した声が永久に埋もれる)
  await Promise.all(fresh.map((f) => kvCmd(["SET", SENT_KEY(f.uuid), "1", "EX", SENT_TTL]).catch(() => null)));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
