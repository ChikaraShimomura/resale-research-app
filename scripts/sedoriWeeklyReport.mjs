// せどり帳 週次レポートメール(個人用cron)。毎週月曜の朝、直近7日をまとめて送る。
// データ源:
//   - PostHog (us.posthog.com project 538873): HogQL query API。要 POSTHOG_API_KEY(personal API key・query:read)
//   - iTunes Lookup / Google Play: どちらも認証不要の公開情報
// 送信は Resend。RESEND_API_KEY 未設定 or `--dry` ならプレビューのみ(非破壊)。
// env: POSTHOG_API_KEY / RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可)
//   任意: ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY / ASC_VENDOR_NUMBER
//        (4つ揃うとApp Store Connectのダウンロード数を出す。無ければその行を出さない)
//
// 方針: 個々のクエリが落ちてもメールは必ず届かせる(そのセクションだけ「取得できず」にする)。
// レポートは毎週流し読みするものなので、件数の羅列ではなく「人・行動・お金」の順に並べる。

import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 週次レポート <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;

const PH_HOST = "https://us.posthog.com";
const PH_PROJECT = 538873;
const APP_ID = "6793951342";
const ANDROID_PACKAGE = "com.chikara.sedoriledger";

// App Store Connect の売上レポート(=ダウンロード数)。4つ揃ったときだけ有効。
// 発行: App Store Connect > Users and Access > Integrations > App Store Connect API
// (Finance または Admin 権限。.p8 は発行時に一度しかダウンロードできない)
const ASC_KEY_ID = process.env.ASC_KEY_ID || "";
const ASC_ISSUER_ID = process.env.ASC_ISSUER_ID || "";
const ASC_PRIVATE_KEY = (process.env.ASC_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const ASC_VENDOR_NUMBER = process.env.ASC_VENDOR_NUMBER || "";
const ascReady = Boolean(ASC_KEY_ID && ASC_ISSUER_ID && ASC_PRIVATE_KEY && ASC_VENDOR_NUMBER);

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

function ascToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" });
  const body = b64({ iss: ASC_ISSUER_ID, iat, exp: iat + 900, aud: "appstoreconnect-v1" });
  // JWSの署名はDERではなく生のR||S(P1363)。dsaEncodingで直接その形にする
  const sig = createSign(`${head}.${body}`);
  return `${head}.${body}.${sig}`;
}

function createSign(input) {
  return crypto
    .sign("sha256", Buffer.from(input), {
      key: ASC_PRIVATE_KEY,
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");
}

/**
 * 直近7日のダウンロード数(初回インストール)。
 * 日次の売上レポートはgzipのTSVで、当日分はまだ無いことが多いので取れた日だけ足す。
 * 未設定・取得失敗なら null(レポートには出さない)。
 */
async function fetchDownloads() {
  if (!ascReady) return null;
  let token;
  try {
    token = ascToken();
  } catch (e) {
    console.error("ASC token failed:", String(e.message || e).slice(0, 160));
    return null;
  }
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - i * 86400 * 1000);
    days.push(d.toISOString().slice(0, 10));
  }
  let total = 0;
  let got = 0;
  const byCountry = new Map();
  for (const day of days) {
    try {
      const url =
        "https://api.appstoreconnect.apple.com/v1/salesReports" +
        `?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY` +
        `&filter[vendorNumber]=${encodeURIComponent(ASC_VENDOR_NUMBER)}&filter[reportDate]=${day}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/a-gzip" },
        signal: AbortSignal.timeout(20000),
      });
      // まだ集計されていない日は404。異常ではないので黙って飛ばす
      if (r.status === 404) continue;
      if (!r.ok) {
        console.error(`ASC salesReports ${day}: ${r.status}`);
        continue;
      }
      const tsv = gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8");
      const parsed = parseFirstTimeUnits(tsv);
      total += parsed.total;
      for (const [cc, n] of parsed.byCountry) byCountry.set(cc, (byCountry.get(cc) || 0) + n);
      got++;
    } catch (e) {
      console.error(`ASC salesReports ${day} failed:`, String(e.message || e).slice(0, 120));
    }
  }
  return got === 0 ? null : { total, days: got, byCountry };
}

/** 売上レポートTSVから初回インストールを合計する(再DL/アップデートは除く)。国別の内訳も返す */
function parseFirstTimeUnits(tsv) {
  const out = { total: 0, byCountry: new Map() };
  const lines = tsv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return out;
  const head = lines[0].split("\t");
  const iType = head.indexOf("Product Type Identifier");
  const iUnits = head.indexOf("Units");
  const iCountry = head.indexOf("Country Code");
  if (iType < 0 || iUnits < 0) return out;
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    // 先頭が1 = 初回ダウンロード(1F=無料アプリ, 1T/1E=対応端末別)。3F/7F等は再DL・アップデート
    if (!String(c[iType] || "").startsWith("1")) continue;
    const n = Number(c[iUnits]) || 0;
    out.total += n;
    const cc = iCountry >= 0 ? String(c[iCountry] || "").trim().toUpperCase() : "";
    if (cc) out.byCountry.set(cc, (out.byCountry.get(cc) || 0) + n);
  }
  return out;
}

/** 国コード→表示名。無いものはコードのまま出す */
const COUNTRY = {
  JP: "日本", US: "アメリカ", KR: "韓国", TW: "台湾", HK: "香港", CN: "中国",
  TH: "タイ", VN: "ベトナム", ID: "インドネシア", PH: "フィリピン", MY: "マレーシア",
  SG: "シンガポール", IN: "インド", GB: "イギリス", CA: "カナダ", AU: "オーストラリア",
  DE: "ドイツ", FR: "フランス", ES: "スペイン", IT: "イタリア",
  BR: "ブラジル", MX: "メキシコ", AR: "アルゼンチン", CL: "チリ",
};
const cname = (cc) => COUNTRY[cc] || cc || "不明";

async function main() {
  // 集計窓 = 直近7日。前週比のため 14〜7日前 も取る
  const W = "timestamp >= now() - interval 7 day";
  const P = "timestamp >= now() - interval 14 day and timestamp < now() - interval 7 day";

  const [ev7, ev14, feedback, purchases, locked, users7Rows, usersPrevRows, users30Rows, newUserRows, retainedRows, countryRows] =
    await Promise.all([
      tryQuery(`select event, count() as c, uniq(person_id) as u from events where ${W} group by event`),
      tryQuery(`select event, count() as c, uniq(person_id) as u from events where ${P} group by event`),
      tryQuery(`select timestamp, properties.message, properties.contact, properties.version from events where event = 'feedback' and ${W} order by timestamp desc limit 50`),
      tryQuery(`select timestamp, properties.tier, properties.period from events where event = 'purchase_completed' and ${W} order by timestamp desc limit 50`),
      tryQuery(`select properties.feature as f, count() as c from events where event = 'plan_locked_tap' and ${W} group by f order by c desc`),
      tryQuery(`select uniq(person_id) from events where ${W}`),
      tryQuery(`select uniq(person_id) from events where ${P}`),
      tryQuery(`select uniq(person_id) from events where timestamp >= now() - interval 30 day`),
      // 今週はじめて使った人。ダウンロード数の代わりに「使い始めた人」として見る
      tryQuery(
        `select count() from (select person_id, min(timestamp) as fs from events group by person_id having fs >= now() - interval 7 day)`,
        `select uniq(person_id) from (select person_id, min(timestamp) as fs from events group by person_id) where fs >= now() - interval 7 day`
      ),
      // 先週使った人のうち今週も使った人(継続率の分子)
      tryQuery(`select uniq(person_id) from events where ${W} and person_id in (select person_id from events where ${P})`),
      // 国別。PostHogがIPから付ける $geoip_country_code。取れない環境では null になる
      tryQuery(
        `select coalesce(nullIf(properties.$geoip_country_code, ''), '?') as cc, uniq(person_id) as u from events where ${W} group by cc order by u desc`,
        `select properties['$geoip_country_code'] as cc, uniq(person_id) as u from events where ${W} group by cc order by u desc`
      ),
    ]);

  const [appStoreLine, downloads] = await Promise.all([fetchAppStore(), fetchDownloads()]);

  // クエリが落ちた分を0と読み違えないよう、失敗があれば本文と件名で断る
  const degraded = [ev7, feedback, purchases, users7Rows, usersPrevRows].some((r) => r == null);

  const users7 = num(users7Rows?.[0]?.[0]);
  const usersPrev = num(usersPrevRows?.[0]?.[0]);
  const users30 = num(users30Rows?.[0]?.[0]);
  const newUsers = num(newUserRows?.[0]?.[0]);
  const retained = num(retainedRows?.[0]?.[0]);
  const retentionPct = retainedRows != null && usersPrev > 0 ? Math.round((retained / usersPrev) * 100) : null;
  const sold = num(pick(ev7, "item_sold")[1]);
  const soldPrev = num(pick(ev14, "item_sold")[1]);
  const paid = (purchases || []).length;

  // 海外 = 国が取れていて日本以外。不明(?)は母数から外す
  const known = (countryRows || []).filter((r) => r[0] && r[0] !== "?");
  const overseasRows = known.filter((r) => r[0] !== "JP").sort((a, b) => num(b[1]) - num(a[1]));
  const overseas = overseasRows.reduce((n, r) => n + num(r[1]), 0);
  const overseasTop = overseasRows.slice(0, 3).map((r) => `${cname(r[0])} ${jp(r[1])}`).join(" / ");
  const overseasCell = countryRows == null || known.length === 0 ? "—" : `${jp(overseas)}人`;

  const end = jstDate();
  const start = jstDate(new Date(Date.now() - 6 * 86400 * 1000));
  const range = `${fmtMD(start)}〜${fmtMD(end)}`;
  const subject = degraded
    ? `せどり帳 週次 ${range}｜一部の数字を取得できませんでした`
    : `せどり帳 週次 ${range}｜使った人${users7}・海外${countryRows == null || known.length === 0 ? "—" : overseas}・課金${paid}`;

  // ── 1行サマリー。読むのはここだけで済むように ──────────────
  const diff = users7 - usersPrev;
  const move =
    users7 === 0
      ? "利用がありませんでした"
      : diff > 0
        ? `先週より${jp(diff)}人ふえました`
        : diff < 0
          ? `先週より${jp(-diff)}人へりました`
          : "先週と同じでした";
  const summary =
    users7 === 0
      ? "今週は利用がありませんでした。"
      : `今週は <b>${jp(users7)}人</b> が使い、${move}。${
          countryRows != null && known.length ? `うち海外が <b>${jp(overseas)}人</b>。` : ""
        }課金は <b>${paid}件</b> でした。`;

  const cell = (label, value, sub) => `<td width="33%" align="center" style="padding:10px 2px;border:1px solid ${LINE};background:#FAFBFC">
      <div style="font-size:11px;color:${MUTED}">${label}</div>
      <div style="font-size:20px;font-weight:bold;color:${INK};padding:1px 0">${value}</div>
      <div style="font-size:11px;color:${MUTED}">${sub || "&nbsp;"}</div>
    </td>`;
  const table = `<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
    <tr>
      ${cell("使った人", `${jp(users7)}人`, delta(users7, usersPrev))}
      ${cell("はじめての人", newUserRows == null ? "—" : `${jp(newUsers)}人`, "")}
      ${cell("継続率", retentionPct != null ? `${retentionPct}%` : "—", retentionPct != null ? `${jp(usersPrev)}人中${jp(retained)}人` : "")}
    </tr>
    <tr>
      ${cell("海外から", overseasCell, overseasTop)}
      ${cell("売却", `${jp(sold)}件`, delta(sold, soldPrev))}
      ${cell("課金", `${jp(paid)}件`, "")}
    </tr>
  </table>`;

  // ── 参考。1行に収める ────────────────────────────
  const dlOverseas = downloads?.byCountry
    ? [...downloads.byCountry].filter(([cc]) => cc !== "JP").reduce((n, [, v]) => n + v, 0)
    : 0;
  const dlLine = downloads
    ? `DL ${jp(downloads.total)}件${downloads.days < 7 ? `(${downloads.days}日分)` : ""}${dlOverseas ? `（海外 ${jp(dlOverseas)}）` : ""}`
    : null;
  const refLine = [`月間 ${users30Rows == null ? "—" : jp(users30) + "人"}`, dlLine, appStoreLine].filter(Boolean).join(" ／ ");

  // ── 届いた声。本文はそのまま出す(要約しない) ──────────────
  const feedbackBlock =
    feedback == null
      ? `<p style="color:${MUTED};font-size:13px">取得できませんでした</p>`
      : feedback.length === 0
        ? `<p style="color:${MUTED};font-size:13px">今週はありません</p>`
        : feedback
            .map(
              (f) => `<div style="border-left:3px solid ${ACCENT};padding:2px 0 2px 10px;margin-bottom:10px">
              <div style="font-size:14px;white-space:pre-wrap">${esc(f[1] || "(本文なし)")}</div>
              <div style="color:${MUTED};font-size:11px;padding-top:2px">${esc(String(f[0]).slice(0, 10))}・v${esc(f[3] || "?")}${f[2] ? "・連絡先 " + esc(f[2]) : ""}</div>
            </div>`
            )
            .join("");

  // ── 有料機能のどこを触ったか。上位3つだけ ────────────────
  const wantedLine =
    locked == null || locked.length === 0
      ? null
      : locked.slice(0, 3).map((l) => `${esc(FEATURE_LABEL[l[0]] || l[0] || "不明")} ${jp(l[1])}`).join(" / ");

  // ── 課金の入口。誰も見ていない週は出さない ──────────────
  const paywallUsers = num(pick(ev7, "paywall_shown")[2]);
  const startedCount = num(pick(ev7, "purchase_started")[1]);
  const funnelLine =
    paywallUsers > 0
      ? `プラン画面 ${jp(paywallUsers)}人 → 購入開始 ${jp(startedCount)} → 課金 ${jp(paid)}${
          (purchases || []).length
            ? `（${purchases.map((x) => `${esc(TIER_LABEL[x[1]] || x[1] || "?")}・${esc(PERIOD_LABEL[x[2]] || x[2] || "?")}`).join(" / ")}）`
            : ""
        }`
      : null;

  const html = `
<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;color:${INK};line-height:1.7">
  <div style="border-bottom:3px solid ${ACCENT};padding-bottom:6px;margin-bottom:12px">
    <div style="font-size:17px;font-weight:bold">📒 せどり帳 週次レポート</div>
    <div style="font-size:12px;color:${MUTED}">${range}</div>
  </div>
  ${degraded ? `<p style="background:#FDF3F1;border:1px solid ${DOWN};color:${DOWN};font-size:12px;padding:8px 10px;margin:0 0 12px">⚠ 一部の数字を取得できませんでした。0と出ていても実際は不明です。</p>` : ""}

  <p style="font-size:14px;margin:0 0 12px">${summary}</p>
  ${table}
  <p style="font-size:11px;color:${MUTED};margin:6px 0 20px">${refLine}</p>

  <h3 style="font-size:14px;color:${ACCENT};margin:0 0 8px">届いた声${feedback && feedback.length ? ` ${feedback.length}件` : ""}</h3>
  ${feedbackBlock}

  ${wantedLine ? `<h3 style="font-size:14px;color:${ACCENT};margin:20px 0 4px">有料機能で触られた場所</h3><p style="font-size:13px;margin:0">${wantedLine}</p>` : ""}
  ${funnelLine ? `<h3 style="font-size:14px;color:${ACCENT};margin:20px 0 4px">課金の入口</h3><p style="font-size:13px;margin:0">${funnelLine}</p>` : ""}

  <p style="color:#A6ABB3;font-size:11px;padding-top:8px;margin-top:20px;border-top:1px solid ${LINE}">
    毎週月曜の朝に自動送信 ／ 直近7日 ／ GitHub Actions sedori-weekly-report
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
