// せどり帳 週次レポートメール(個人用cron)。毎週月曜9:00 JSTにPostHog+App Storeの数字をまとめて送る。
// データ源:
//   - PostHog (us.posthog.com project 538873): HogQL query API。要 POSTHOG_API_KEY(personal API key・query:read)。
//   - iTunes Lookup API (認証不要): 公開中バージョン・評価。
// 送信は Resend。RESEND_API_KEY 未設定 or `--dry` ならプレビューのみ(非破壊)。
// env: POSTHOG_API_KEY / RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可)

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 週次レポート <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;

const PH_HOST = "https://us.posthog.com";
const PH_PROJECT = 538873;
const APP_ID = "6793951342";

if (!POSTHOG_API_KEY) {
  console.error("POSTHOG_API_KEY がありません");
  process.exit(1);
}

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

function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000);
}
function fmtMD(d) {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const num = (v) => Number(v) || 0;

async function main() {
  // 集計窓 = 直近7日(前週比のため直近14日も取る)
  const [daily, ev7, ev14, feedback, purchases, locked, trialStarts] = await Promise.all([
    hogql("select toDate(timestamp) as d, uniq(person_id) as u, count() as c from events where timestamp >= now() - interval 7 day group by d order by d"),
    hogql("select event, count() as c, uniq(person_id) as u from events where timestamp >= now() - interval 7 day group by event"),
    hogql("select event, count() as c, uniq(person_id) as u from events where timestamp >= now() - interval 14 day and timestamp < now() - interval 7 day group by event"),
    hogql("select timestamp, properties.message, properties.contact, properties.version from events where event = 'feedback' and timestamp >= now() - interval 7 day order by timestamp desc limit 50"),
    hogql("select timestamp, properties.tier, properties.period from events where event = 'purchase_completed' and timestamp >= now() - interval 7 day order by timestamp desc limit 50"),
    hogql("select properties.feature as f, count() as c from events where event = 'plan_locked_tap' and timestamp >= now() - interval 7 day group by f order by c desc"),
    hogql("select count() from events where event = 'purchase_started' and timestamp >= now() - interval 7 day"),
  ]);

  // App Store(公開情報)
  let store = null;
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${APP_ID}&country=jp`, { signal: AbortSignal.timeout(15000) });
    store = (await r.json()).results?.[0] || null;
  } catch {}

  const get = (rows, name) => rows.find((x) => x[0] === name) || [name, 0, 0];
  const wow = (name) => {
    const now = num(get(ev7, name)[1]);
    const prev = num(get(ev14, name)[1]);
    const diff = now - prev;
    return `${now}件 (前週${diff >= 0 ? "+" : ""}${diff})`;
  };

  const wau = Math.max(...[0, ...daily.map((d) => num(d[1]))]);
  const totalUsers7 = num((await hogql("select uniq(person_id) from events where timestamp >= now() - interval 7 day"))[0]?.[0]);
  const totalUsersPrev = num((await hogql("select uniq(person_id) from events where timestamp >= now() - interval 14 day and timestamp < now() - interval 7 day"))[0]?.[0]);

  const end = jstDate();
  const start = jstDate(new Date(Date.now() - 7 * 86400 * 1000));
  const subject = `せどり帳 週次レポート ${fmtMD(start)}〜${fmtMD(end)}`;

  const dailyRows = daily
    .map((d) => `<tr><td>${esc(d[0])}</td><td align="right">${num(d[1])}人</td><td align="right">${num(d[2])}件</td></tr>`)
    .join("");

  const purchaseRows = purchases.length
    ? purchases.map((p) => `<li>${esc(String(p[0]).slice(0, 10))} — ${esc(p[1])} / ${esc(p[2])}</li>`).join("")
    : "<li>今週の購入はありません</li>";

  const lockedRows = locked.length
    ? locked.map((l) => `<li>${esc(l[0] || "不明")}: ${num(l[1])}回</li>`).join("")
    : "<li>なし</li>";

  const jpFeature = { stats: "集計(スタンダード)", fee: "手数料プリセット(スタンダード)", category: "カテゴリ(プレミアム)" };
  const lockedRowsJp = locked.length
    ? locked.map((l) => `<li>${esc(jpFeature[l[0]] || l[0] || "不明")}: ${num(l[1])}回</li>`).join("")
    : "<li>なし</li>";

  const feedbackRows = feedback.length
    ? feedback
        .map(
          (f) =>
            `<li style="margin-bottom:8px"><div>${esc(f[1] || "(本文なし)")}</div><div style="color:#888;font-size:12px">${esc(String(f[0]).slice(0, 10))}・v${esc(f[3] || "?")}${f[2] ? "・連絡先: " + esc(f[2]) : ""}</div></li>`
        )
        .join("")
    : "<li>今週の要望はありません</li>";

  const storeLine = store
    ? `公開バージョン v${esc(store.version)} ／ 評価 ${store.userRatingCount ?? 0}件・平均★${store.averageUserRating ? store.averageUserRating.toFixed(1) : "-"}`
    : "取得できませんでした";

  const html = `
<div style="font-family:-apple-system,'Hiragino Sans',sans-serif;max-width:640px;margin:0 auto;color:#2D323B">
  <h2 style="border-bottom:2px solid #3D5166;padding-bottom:8px">📒 せどり帳 週次レポート <span style="font-weight:normal;font-size:14px">${fmtMD(start)}〜${fmtMD(end)}</span></h2>

  <h3>👥 アクティブユーザー</h3>
  <p>週間ユニーク: <b>${totalUsers7}人</b> (前週 ${totalUsersPrev}人 / 日別最大 ${wau}人)</p>
  <table cellpadding="6" style="border-collapse:collapse;font-size:13px" border="1" bordercolor="#e5e5e5">
    <tr style="background:#f5f6f8"><th>日付</th><th>ユーザー</th><th>イベント</th></tr>
    ${dailyRows || "<tr><td colspan='3'>データなし</td></tr>"}
  </table>

  <h3>📈 利用状況(前週比)</h3>
  <ul style="line-height:1.9">
    <li>仕入れ登録: ${wow("item_added")}</li>
    <li>売却登録: ${wow("item_sold")}</li>
    <li>アプリ起動: ${wow("Application Opened")}</li>
    <li>CSV書き出し: ${wow("csv_exported")} ／ SNS共有: ${wow("share_posted")}</li>
  </ul>

  <h3>💰 課金</h3>
  <ul style="line-height:1.9">
    <li>ペイウォール表示: ${wow("paywall_shown")}</li>
    <li>購入開始: ${num(trialStarts[0]?.[0])}件 ／ 購入完了(トライアル開始含む):</li>
    ${purchaseRows}
    <li style="margin-top:6px">ロック機能タップ(欲しがられている機能):</li>
    ${lockedRowsJp}
  </ul>

  <h3>📝 要望一覧(今週)</h3>
  <ul style="line-height:1.6">${feedbackRows}</ul>

  <h3>🏪 App Store</h3>
  <p>${storeLine}</p>

  <p style="color:#999;font-size:11px;border-top:1px solid #eee;padding-top:8px;margin-top:24px">
    毎週月曜9:00に自動送信 ／ データ: PostHog(直近7日) + iTunes Lookup ／ GitHub Actions sedori-weekly-report
  </p>
</div>`;

  if (DRY) {
    console.log("=== DRY RUN ===");
    console.log("subject:", subject);
    console.log(html);
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
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
