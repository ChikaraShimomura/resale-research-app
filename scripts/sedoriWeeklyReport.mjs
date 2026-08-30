// せどり帳 週次レポートメール(個人用cron)。毎週月曜の朝、直近7日をまとめて送る。
// データ源:
//   - PostHog (us.posthog.com project 538873): HogQL query API。要 POSTHOG_API_KEY(personal API key・query:read)
//   - iTunes Lookup / Google Play: どちらも認証不要の公開情報
// 送信は Resend。RESEND_API_KEY 未設定 or `--dry` ならプレビューのみ(非破壊)。
// env: POSTHOG_API_KEY / RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可)
//
// 方針: 個々のクエリが落ちてもメールは必ず届かせる(そのセクションだけ「取得できず」にする)。
// レポートは毎週流し読みするものなので、件数の羅列ではなく「人・行動・お金」の順に並べる。

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 週次レポート <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;

const PH_HOST = "https://us.posthog.com";
const PH_PROJECT = 538873;
const APP_ID = "6793951342";
const ANDROID_PACKAGE = "com.chikara.sedoriledger";

// アプリ側でtrack()を足したらここにも足す。載っていないイベントはメールに出ない。
const ACTIONS = [
  ["item_added", "仕入れを登録"],
  ["item_sold", "売却を登録"],
  ["expense_added", "経費を登録"],
  ["csv_exported", "確定申告・CSVを書き出し"],
  ["kobutsu_csv_exported", "古物台帳を書き出し"],
  ["share_posted", "SNSに投稿"],
  ["share_saved", "画像を保存"],
];
// 補足程度の数字。0件なら行ごと出さない
const MINOR = [
  ["Application Opened", "アプリ起動"],
  ["profit_card_shown", "お祝いカード"],
  ["review_requested", "レビュー依頼"],
  ["lang_changed", "言語切替"],
];
const FEATURE_LABEL = {
  stats: "集計（スタンダード）",
  fee: "手数料プリセット（スタンダード）",
  category: "カテゴリ（プレミアム）",
  kobutsu: "古物台帳（プレミアム）",
  kobutsu_csv: "古物台帳の書き出し（プレミアム）",
  ads: "広告を消す（広告の下の導線）",
  ads_settings: "広告を消す（設定画面）",
  group: "グループ共有（スタンダード）",
  flags: "フラグ（スタンダード）",
  ledgers: "帳簿の追加（プレミアム）",
};
const TIER_LABEL = { lite: "ライト", standard: "スタンダード", premium: "プレミアム" };
const PERIOD_LABEL = { monthly: "月額", yearly: "年額" };

const INK = "#2D323B";
const ACCENT = "#3D5166";
const UP = "#1E8E5A";
const DOWN = "#C7503A";
const MUTED = "#8A8F98";
const LINE = "#E6E8EC";

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

/** 候補クエリを順に試し、全部ダメなら null(=そのセクションだけ「取得できず」にする) */
async function tryQuery(...queries) {
  for (const q of queries) {
    try {
      return await hogql(q);
    } catch (e) {
      console.error("query failed:", String(e.message || e).slice(0, 160));
    }
  }
  return null;
}

const num = (v) => Number(v) || 0;
const jp = (n) => num(n).toLocaleString("ja-JP");

function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000);
}
function fmtMD(d) {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** 前週比のバッジ。0なら±0をグレーで */
function delta(now, prev) {
  const d = num(now) - num(prev);
  if (d === 0) return `<span style="color:${MUTED};font-size:12px">±0</span>`;
  const color = d > 0 ? UP : DOWN;
  return `<span style="color:${color};font-size:12px">${d > 0 ? "+" : "−"}${jp(Math.abs(d))}</span>`;
}

/** [event, count, uniq] の行から拾う */
const pick = (rows, name) => (rows || []).find((x) => x[0] === name) || [name, 0, 0];

async function fetchAppStore() {
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${APP_ID}&country=jp`, { signal: AbortSignal.timeout(15000) });
    const a = (await r.json()).results?.[0];
    if (!a) return "取得できませんでした";
    const stars = a.averageUserRating ? `★${a.averageUserRating.toFixed(1)}（${jp(a.userRatingCount || 0)}件）` : "評価はまだありません";
    return `公開中 v${esc(a.version)} ／ ${stars}`;
  } catch {
    return "取得できませんでした";
  }
}

async function fetchPlayStore() {
  try {
    const r = await fetch(`https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&hl=ja&gl=jp`, {
      headers: { "accept-language": "ja" },
      signal: AbortSignal.timeout(15000),
    });
    // クローズドテスト中はストアページが公開されないので404になる(異常ではない)
    if (r.status === 404) return "まだ一般公開していません（テスト配信中）";
    if (!r.ok) return `取得できませんでした（HTTP ${r.status}）`;
    const html = await r.text();
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const ld = JSON.parse(m[1]);
        const ar = ld?.aggregateRating;
        if (ar?.ratingValue) {
          return `公開中 ／ ★${Number(ar.ratingValue).toFixed(1)}（${jp(ar.ratingCount || 0)}件）`;
        }
      } catch {}
    }
    return "公開中（評価はまだ取得できません）";
  } catch {
    return "取得できませんでした";
  }
}

async function main() {
  // 集計窓 = 直近7日。前週比のため 14〜7日前 も取る
  const W = "timestamp >= now() - interval 7 day";
  const P = "timestamp >= now() - interval 14 day and timestamp < now() - interval 7 day";

  const [daily, ev7, ev14, feedback, purchases, locked, osRows, users7Rows, usersPrevRows] = await Promise.all([
    tryQuery(`select toDate(timestamp) as d, uniq(person_id) as u, count() as c from events where ${W} group by d order by d`),
    tryQuery(`select event, count() as c, uniq(person_id) as u from events where ${W} group by event`),
    tryQuery(`select event, count() as c, uniq(person_id) as u from events where ${P} group by event`),
    tryQuery(`select timestamp, properties.message, properties.contact, properties.version from events where event = 'feedback' and ${W} order by timestamp desc limit 50`),
    tryQuery(`select timestamp, properties.tier, properties.period from events where event = 'purchase_completed' and ${W} order by timestamp desc limit 50`),
    tryQuery(`select properties.feature as f, count() as c, uniq(person_id) as u from events where event = 'plan_locked_tap' and ${W} group by f order by c desc`),
    // PostHog React Native が付ける端末プロパティは $os_name。取れない環境向けに $os も見る。
    // ドット記法が通らない場合に備えてブラケット記法へ落ちる
    tryQuery(
      `select coalesce(nullIf(properties.$os_name, ''), nullIf(properties.$os, ''), '不明') as os, uniq(person_id) as u, count() as c from events where ${W} group by os order by u desc`,
      `select properties['$os_name'] as os, uniq(person_id) as u, count() as c from events where ${W} group by os order by u desc`,
      `select properties.$os_name as os, uniq(person_id) as u, count() as c from events where ${W} group by os order by u desc`
    ),
    tryQuery(`select uniq(person_id) from events where ${W}`),
    tryQuery(`select uniq(person_id) from events where ${P}`),
  ]);

  const [appStoreLine, playStoreLine] = await Promise.all([fetchAppStore(), fetchPlayStore()]);

  // クエリが落ちた分は 0 として描画されてしまう。0件なのか取れなかったのかを
  // 読み手が取り違えないよう、1つでも失敗していたら本文と件名で断る
  const degraded = [daily, ev7, ev14, feedback, purchases, locked, osRows, users7Rows, usersPrevRows].some(
    (r) => r == null
  );

  const users7 = num(users7Rows?.[0]?.[0]);
  const usersPrev = num(usersPrevRows?.[0]?.[0]);
  const added = num(pick(ev7, "item_added")[1]);
  const addedPrev = num(pick(ev14, "item_added")[1]);
  const sold = num(pick(ev7, "item_sold")[1]);
  const soldPrev = num(pick(ev14, "item_sold")[1]);
  const paid = (purchases || []).length;

  const end = jstDate();
  const start = jstDate(new Date(Date.now() - 6 * 86400 * 1000));
  const days = daily || [];
  const fmtIso = (iso) => {
    const [, m, d] = String(iso).split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  const range = days.length
    ? `${fmtIso(days[0][0])}〜${fmtIso(days[days.length - 1][0])}`
    : `${fmtMD(start)}〜${fmtMD(end)}`;
  const subject = degraded
    ? `せどり帳 週次 ${range}｜一部の数字を取得できませんでした`
    : `せどり帳 週次 ${range}｜${users7}人・仕入${added}・売却${sold}・課金${paid}`;

  // ── ひとことサマリー ──────────────────────────────
  const userDiff = users7 - usersPrev;
  const trend =
    users7 === 0
      ? "今週は利用がありませんでした。"
      : userDiff > 0
      ? `先週より ${userDiff}人ふえて <b>${users7}人</b> が使いました。`
      : userDiff < 0
      ? `先週より ${-userDiff}人へって <b>${users7}人</b> が使いました。`
      : `先週と同じ <b>${users7}人</b> が使いました。`;
  const summary =
    users7 === 0
      ? trend
      : `${trend} 仕入れ <b>${jp(added)}件</b>・売却 <b>${jp(sold)}件</b> が記録され、課金は <b>${paid}件</b> でした。`;

  // ── 4つの数字 ────────────────────────────────
  const cards = [
    { label: "使った人", value: `${jp(users7)}人`, d: delta(users7, usersPrev) },
    { label: "仕入れを登録", value: `${jp(added)}件`, d: delta(added, addedPrev) },
    { label: "売却を登録", value: `${jp(sold)}件`, d: delta(sold, soldPrev) },
    { label: "課金", value: `${jp(paid)}件`, d: "" },
  ]
    .map(
      (c) => `<td width="25%" align="center" style="padding:12px 4px;border:1px solid ${LINE};background:#FAFBFC">
        <div style="font-size:11px;color:${MUTED}">${c.label}</div>
        <div style="font-size:22px;font-weight:bold;color:${INK};padding:2px 0">${c.value}</div>
        <div>${c.d || "&nbsp;"}</div>
      </td>`
    )
    .join("");

  // ── 日ごとの利用者(横棒) ─────────────────────────
  let dailyBlock;
  if (daily == null) {
    dailyBlock = `<p style="color:${MUTED}">取得できませんでした</p>`;
  } else if (days.length === 0) {
    dailyBlock = `<p style="color:${MUTED}">データがありません</p>`;
  } else {
    const max = Math.max(1, ...days.map((d) => num(d[1])));
    dailyBlock = `<table cellpadding="0" cellspacing="0" width="100%" style="font-size:12px">${days
      .map((d) => {
        const u = num(d[1]);
        const w = Math.round((u / max) * 100);
        const label = String(d[0] ?? "").slice(5).replace("-", "/");
        return `<tr>
          <td width="42" style="color:${MUTED};padding:2px 0">${esc(label)}</td>
          <td style="padding:2px 0"><div style="background:${ACCENT};height:10px;width:${w}%;border-radius:2px"></div></td>
          <td width="42" align="right" style="color:${INK};padding:2px 0">${jp(u)}人</td>
        </tr>`;
      })
      .join("")}</table>`;
  }

  // ── 使われた機能 ─────────────────────────────
  const actionRows = ACTIONS.map(([ev, label]) => {
    const now = num(pick(ev7, ev)[1]);
    const uniq = num(pick(ev7, ev)[2]);
    const prev = num(pick(ev14, ev)[1]);
    const value = now === 0 ? `<span style="color:${MUTED}">0</span>` : `${jp(now)}件<span style="color:${MUTED}">（${jp(uniq)}人）</span>`;
    return `<tr>
      <td style="padding:6px 0;border-bottom:1px solid ${LINE}">${label}</td>
      <td align="right" style="padding:6px 0;border-bottom:1px solid ${LINE}">${value}</td>
      <td align="right" width="52" style="padding:6px 0;border-bottom:1px solid ${LINE}">${delta(now, prev)}</td>
    </tr>`;
  }).join("");

  const minorText = MINOR.map(([ev, label]) => [label, num(pick(ev7, ev)[1])])
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${jp(n)}`)
    .join(" ／ ");

  // ── 課金までの流れ ────────────────────────────
  const paywallUsers = num(pick(ev7, "paywall_shown")[2]);
  const startedCount = num(pick(ev7, "purchase_started")[1]);
  const funnel = [
    ["ペイウォールを見た", `${jp(paywallUsers)}人`],
    ["購入を始めた", `${jp(startedCount)}回`],
    ["購入した", `${jp(paid)}件`],
  ]
    .map(
      ([l, v], i) => `<td align="center" style="padding:10px 4px;border:1px solid ${LINE};${i === 2 ? `background:#F4F8F5` : ""}">
        <div style="font-size:11px;color:${MUTED}">${l}</div>
        <div style="font-size:18px;font-weight:bold;color:${INK}">${v}</div>
      </td>${i < 2 ? `<td width="18" align="center" style="color:${MUTED}">›</td>` : ""}`
    )
    .join("");

  const purchaseDetail = (purchases || []).length
    ? `<p style="margin:8px 0 0;font-size:13px">内訳: ${purchases
        .map((p) => `${esc(String(p[0]).slice(5, 10))} ${esc(TIER_LABEL[p[1]] || p[1] || "?")}・${esc(PERIOD_LABEL[p[2]] || p[2] || "?")}`)
        .join(" ／ ")}</p>`
    : "";

  const wantedBlock =
    locked == null
      ? `<p style="color:${MUTED};font-size:13px">取得できませんでした</p>`
      : locked.length === 0
      ? `<p style="color:${MUTED};font-size:13px">今週はロック機能がタップされませんでした</p>`
      : `<table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px">${locked
          .map(
            (l) => `<tr>
              <td style="padding:4px 0">${esc(FEATURE_LABEL[l[0]] || l[0] || "不明")}</td>
              <td align="right" style="padding:4px 0">${jp(l[1])}回<span style="color:${MUTED}">（${jp(l[2])}人）</span></td>
            </tr>`
          )
          .join("")}</table>`;

  // ── 要望 ────────────────────────────────
  const feedbackBlock =
    feedback == null
      ? `<p style="color:${MUTED}">取得できませんでした</p>`
      : feedback.length === 0
      ? `<p style="color:${MUTED}">今週の要望はありません</p>`
      : feedback
          .map(
            (f) => `<div style="border-left:3px solid ${ACCENT};padding:2px 0 2px 10px;margin-bottom:10px">
              <div style="font-size:14px;white-space:pre-wrap">${esc(f[1] || "(本文なし)")}</div>
              <div style="color:${MUTED};font-size:11px;padding-top:2px">${esc(String(f[0]).slice(0, 10))}・v${esc(f[3] || "?")}${f[2] ? "・連絡先 " + esc(f[2]) : ""}</div>
            </div>`
          )
          .join("");

  // ── 端末 ────────────────────────────────
  const osBlock =
    osRows == null
      ? `<span style="color:${MUTED}">取得できませんでした</span>`
      : osRows.length === 0
      ? `<span style="color:${MUTED}">データがありません</span>`
      : osRows.map((o) => `${esc(o[0] || "不明")} ${jp(o[1])}人`).join(" ／ ");

  const html = `
<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;max-width:600px;margin:0 auto;color:${INK};line-height:1.7">
  <div style="border-bottom:3px solid ${ACCENT};padding-bottom:6px;margin-bottom:14px">
    <div style="font-size:19px;font-weight:bold">📒 せどり帳 週次レポート</div>
    <div style="font-size:12px;color:${MUTED}">${range} のまとめ</div>
  </div>

  ${
    degraded
      ? `<p style="background:#FDF3F1;border:1px solid ${DOWN};color:${DOWN};font-size:12px;padding:8px 10px;margin:0 0 14px">⚠ PostHogへの問い合わせが一部失敗しました。0と出ている数字は、本当に0なのか取得できなかったのか区別がつきません。</p>`
      : ''
  }
  <p style="font-size:15px;margin:0 0 16px">${summary}</p>

  <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:22px"><tr>${cards}</tr></table>

  <h3 style="font-size:14px;color:${ACCENT};margin:0 0 6px">日ごとの利用者</h3>
  ${dailyBlock}

  <h3 style="font-size:14px;color:${ACCENT};margin:22px 0 4px">使われた機能</h3>
  <table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px">${actionRows}</table>
  ${minorText ? `<p style="color:${MUTED};font-size:11px;margin:6px 0 0">${minorText}</p>` : ""}

  <h3 style="font-size:14px;color:${ACCENT};margin:22px 0 6px">課金までの流れ</h3>
  <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr>${funnel}</tr></table>
  ${purchaseDetail}
  <p style="font-size:12px;color:${MUTED};margin:14px 0 4px">ロックを押された＝ほしがられている機能</p>
  ${wantedBlock}

  <h3 style="font-size:14px;color:${ACCENT};margin:22px 0 8px">今週届いた要望</h3>
  ${feedbackBlock}

  <h3 style="font-size:14px;color:${ACCENT};margin:22px 0 6px">配信状況</h3>
  <table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px">
    <tr><td width="96" style="color:${MUTED};padding:3px 0">App Store</td><td style="padding:3px 0">${appStoreLine}</td></tr>
    <tr><td style="color:${MUTED};padding:3px 0">Google Play</td><td style="padding:3px 0">${playStoreLine}</td></tr>
    <tr><td style="color:${MUTED};padding:3px 0">使われた端末</td><td style="padding:3px 0">${osBlock}</td></tr>
  </table>

  <p style="color:#A6ABB3;font-size:11px;border-top:1px solid ${LINE};padding-top:8px;margin-top:26px">
    毎週月曜の朝に自動送信 ／ 直近7日のPostHog + 各ストアの公開情報 ／ GitHub Actions sedori-weekly-report
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
