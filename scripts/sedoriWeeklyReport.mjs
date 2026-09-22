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

// お問い合わせ(2.2.0〜)。3つ揃ったときだけ読む(未設定なら PostHog の feedback だけ)
const SB_URL = process.env.SEDORI_SUPABASE_URL || "";
const SB_ANON = process.env.SEDORI_SUPABASE_ANON_KEY || "";
const INQUIRY_TOKEN = process.env.SEDORI_INQUIRY_TOKEN || "";

/** 写真共有(2.2.0〜)のファイル置き場の使用量。未設定・失敗は null。無料枠は 1GB */
async function fetchStorageUsage() {
  if (!(SB_URL && SB_ANON && INQUIRY_TOKEN)) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/storage_usage_for_report`, {
      method: "POST",
      headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: INQUIRY_TOKEN }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const row = (await r.json())?.[0];
    return row ? { files: Number(row.files) || 0, bytes: Number(row.bytes) || 0, ledgers: Number(row.ledgers) || 0 } : null;
  } catch {
    return null;
  }
}
/** 800MB を超えたら件名と本文で知らせる(無料枠 1GB の手前) */
const STORAGE_WARN_BYTES = 800 * 1024 * 1024;

/** 直近7日のお問い合わせ(新しい順)。未設定・失敗は null */
async function fetchInquiries() {
  if (!(SB_URL && SB_ANON && INQUIRY_TOKEN)) return null;
  try {
    const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const r = await fetch(`${SB_URL}/rest/v1/rpc/inquiries_since`, {
      method: "POST",
      headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: INQUIRY_TOKEN, p_since: since }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      console.error(`inquiries_since ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("inquiries_since failed:", String(e.message || e).slice(0, 120));
    return null;
  }
}

// アプリ側でtrack()を足したらここにも足す。載っていないイベントはメールに出ない。
// 「今週の動き」の1行に、1以上のものだけ並ぶ(ACTIONS=件数 / PEOPLE=人数)
const ACTIONS = [
  ["item_added", "仕入れ"],
  ["item_sold", "売却"],
  ["import_completed", "取り込み"],
  ["expense_added", "経費"],
  ["csv_exported", "CSV書き出し"],
  ["kobutsu_csv_exported", "古物台帳の書き出し"],
  ["share_posted", "SNS投稿"],
];
const PEOPLE = [
  ["ad_interstitial_shown", "全画面広告を見た人"],
  ["tutorial_done", "チュートリアル完了"],
  ["tutorial_skip", "チュートリアルをスキップ"],
  // 2.2.0〜
  ["fee_auto_free_used", "手数料の無料枠を使った人"],
  ["upsell_card_tap", "集計のCSVカードを押した人"],
  ["group_paused_shown", "グループの一時停止の画面を見た人"],
  ["paywall_dismissed", "プラン画面を閉じた人"],
  ["purchase_cancelled", "購入をやめた人"],
];
// plan_locked_tap の feature。プランは月額¥150の1本(2026-09〜)なのでプラン名は付けない
const FEATURE_LABEL = {
  fee: "手数料の自動計算",
  stats: "集計の強化",
  category: "カテゴリ",
  flags: "色フラグ",
  kobutsu: "古物台帳",
  kobutsu_csv: "古物台帳の書き出し",
  ads: "広告を消す(バナーの導線・2.1以前)",
  ads_settings: "広告を消す(設定)",
  group: "3人以上の共有",
  group_paused: "一時停止中のプラン再開",
  ledgers: "帳簿の追加",
  import: "取り込み(上限超え)",
  csv: "CSVの書き出し",
  expense: "経費の登録",
};
// purchase_completed の product。iOS は商品ID、Android は「商品ID:基本プランID」
const PRODUCT_LABEL = (id) => {
  const s = String(id || "");
  if (!s) return "?";
  const os = s.includes(":") ? "Android" : "iOS";
  const period = /year/i.test(s) ? "年額" : /month/i.test(s) ? "月額" : s;
  return `${os}・${period}`;
};

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

  // 日本の利用者の「初日」(JST)。継続率とファネルは日本だけで見る
  // (米国は Apple/Google の審査端末が多く、ビルドのたびに新しい人として数えられるため)
  const JP_FIRST = `(select person_id, min(toDate(toTimeZone(timestamp, 'Asia/Tokyo'))) as d0 from events where properties.$geoip_country_code = 'JP' group by person_id)`;
  // 7日継続: 初日から7〜13日目に一度でも使った人の割合。対象は初日が a〜b 日前の人(13日目まで見終わった人だけ)
  const d7 = (a, b) => `select count() as cohort, countIf(back > 0) as kept from (
      select f.person_id as pid,
        countIf(toDate(toTimeZone(e.timestamp, 'Asia/Tokyo')) >= f.d0 + 7 and toDate(toTimeZone(e.timestamp, 'Asia/Tokyo')) <= f.d0 + 13) as back
      from ${JP_FIRST} as f join events as e on e.person_id = f.person_id
      where f.d0 >= today() - ${b} and f.d0 <= today() - ${a} and e.timestamp >= now() - interval ${b + 2} day
      group by f.person_id)`;

  const [ev7, ev14, feedback, purchases, locked, users7Rows, usersPrevRows, users30Rows, newUserRows, d7Rows, d7PrevRows, funnelRows, countryRows] =
    await Promise.all([
      tryQuery(`select event, count() as c, uniq(person_id) as u from events where ${W} group by event`),
      tryQuery(`select event, count() as c, uniq(person_id) as u from events where ${P} group by event`),
      tryQuery(`select timestamp, properties.message, properties.contact, properties.version from events where event = 'feedback' and ${W} order by timestamp desc limit 50`),
      tryQuery(`select timestamp, properties.product from events where event = 'purchase_completed' and ${W} order by timestamp desc limit 50`),
      tryQuery(`select properties.feature as f, count() as c from events where event = 'plan_locked_tap' and ${W} group by f order by c desc`),
      tryQuery(`select uniq(person_id) from events where ${W}`),
      tryQuery(`select uniq(person_id) from events where ${P}`),
      tryQuery(`select uniq(person_id) from events where timestamp >= now() - interval 30 day`),
      // 今週はじめて使った人。ダウンロード数の代わりに「使い始めた人」として見る
      tryQuery(
        `select count() from (select person_id, min(timestamp) as fs from events group by person_id having fs >= now() - interval 7 day)`,
        `select uniq(person_id) from (select person_id, min(timestamp) as fs from events group by person_id) where fs >= now() - interval 7 day`
      ),
      // 7日継続(日本)。今回=初日が2〜4週前の人、比較=4〜6週前の人
      tryQuery(d7(14, 27)),
      tryQuery(d7(28, 41)),
      // 課金までの流れ(日本・直近30日に使い始めた人が、これまでにしたこと)
      tryQuery(`select count() as users, countIf(added >= 1) as a1, countIf(added >= 3) as a3, countIf(locked >= 1) as lk,
          countIf(paywall >= 1) as pw, countIf(started >= 1) as st, countIf(done >= 1) as dn
        from (
          select person_id,
            countIf(event = 'item_added') as added, countIf(event = 'plan_locked_tap') as locked, countIf(event = 'paywall_shown') as paywall,
            countIf(event = 'purchase_started') as started, countIf(event = 'purchase_completed') as done
          from events
          where person_id in (select person_id from events where properties.$geoip_country_code = 'JP' group by person_id having min(timestamp) >= now() - interval 30 day)
          group by person_id)`),
      // 国別。PostHogがIPから付ける $geoip_country_code。取れない環境では null になる
      tryQuery(
        `select coalesce(nullIf(properties.$geoip_country_code, ''), '?') as cc, uniq(person_id) as u from events where ${W} group by cc order by u desc`,
        `select properties['$geoip_country_code'] as cc, uniq(person_id) as u from events where ${W} group by cc order by u desc`
      ),
    ]);

  const [appStoreLine, downloads, inquiries, storage] = await Promise.all([fetchAppStore(), fetchDownloads(), fetchInquiries(), fetchStorageUsage()]);
  const storageWarn = storage != null && storage.bytes >= STORAGE_WARN_BYTES;
  const storageLine = storage
    ? `共有画像 ${(storage.bytes / 1024 / 1024).toFixed(1)}MB / 1GB(${jp(storage.files)}枚・${jp(storage.ledgers)}帳簿)`
    : null;
  // 届いた声 = 2.1.0 以前(PostHog・本文あり)+ 2.2.0〜(Supabase・kind=feedback)
  const voices = [
    ...(feedback || [])
      .filter((f) => String(f[1] ?? "").trim() !== "")
      .map((f) => ({ at: String(f[0]), body: f[1], contact: f[2], version: f[3] })),
    ...(inquiries || [])
      .filter((q) => q.kind === "feedback")
      .map((q) => ({ at: String(q.created_at), body: q.body, contact: q.contact, version: q.app_version })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const businessCount = (inquiries || []).filter((q) => q.kind === "business").length;

  // クエリが落ちた分を0と読み違えないよう、失敗があれば本文と件名で断る
  const degraded = [ev7, feedback, purchases, users7Rows, usersPrevRows, d7Rows, funnelRows].some((r) => r == null);

  const users7 = num(users7Rows?.[0]?.[0]);
  const usersPrev = num(usersPrevRows?.[0]?.[0]);
  const users30 = num(users30Rows?.[0]?.[0]);
  const newUsers = num(newUserRows?.[0]?.[0]);
  const pct = (rows) => {
    const c = num(rows?.[0]?.[0]);
    const k = num(rows?.[0]?.[1]);
    return rows != null && c > 0 ? { c, k, p: Math.round((k / c) * 100) } : null;
  };
  const d7Now = pct(d7Rows);
  const d7Prev = pct(d7PrevRows);
  const sold = num(pick(ev7, "item_sold")[1]);
  const soldPrev = num(pick(ev14, "item_sold")[1]);
  // purchase_completed はお試し開始でも出る(お試し中も有料扱い)。本当の課金は RevenueCat 側で見る
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
  const subjectBase = degraded
    ? `せどり帳 週次 ${range}｜一部の数字を取得できませんでした`
    : `せどり帳 週次 ${range}｜使った人${users7}・7日継続${d7Now ? d7Now.p + "%" : "—"}・お試し/購入${paid}`;
  const subject = storageWarn ? `⚠画像が800MB超 ${subjectBase}` : subjectBase;

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
        }お試し開始・購入は <b>${paid}件</b> でした。`;

  const cell = (label, value, sub) => `<td width="33%" align="center" style="padding:10px 2px;border:1px solid ${LINE};background:#FAFBFC">
      <div style="font-size:11px;color:${MUTED}">${label}</div>
      <div style="font-size:20px;font-weight:bold;color:${INK};padding:1px 0">${value}</div>
      <div style="font-size:11px;color:${MUTED}">${sub || "&nbsp;"}</div>
    </td>`;
  const table = `<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
    <tr>
      ${cell("使った人", `${jp(users7)}人`, delta(users7, usersPrev))}
      ${cell("はじめての人", newUserRows == null ? "—" : `${jp(newUsers)}人`, "")}
      ${cell("7日継続(日本)", d7Now ? `${d7Now.p}%` : "—", d7Now ? `${jp(d7Now.c)}人中${jp(d7Now.k)}人${d7Prev ? `(前${d7Prev.p}%)` : ""}` : "")}
    </tr>
    <tr>
      ${cell("海外から", overseasCell, overseasTop ? `${overseasTop}${overseasRows.some((r) => r[0] === "US") ? "<br>※米国は審査端末を含む" : ""}` : "")}
      ${cell("売却", `${jp(sold)}件`, delta(sold, soldPrev))}
      ${cell("お試し・購入", `${jp(paid)}件`, (purchases || []).length ? esc(purchases.map((x) => PRODUCT_LABEL(x[1])).join(" / ")) : "")}
    </tr>
  </table>`;

  // ── 参考。1行に収める ────────────────────────────
  const dlOverseas = downloads?.byCountry
    ? [...downloads.byCountry].filter(([cc]) => cc !== "JP").reduce((n, [, v]) => n + v, 0)
    : 0;
  const dlLine = downloads
    ? `DL ${jp(downloads.total)}件${downloads.days < 7 ? `(${downloads.days}日分)` : ""}${dlOverseas ? `（海外 ${jp(dlOverseas)}）` : ""}`
    : null;
  const refLine = [`月間 ${users30Rows == null ? "—" : jp(users30) + "人"}`, dlLine, storageLine, appStoreLine].filter(Boolean).join(" ／ ");

  // ── 届いた声。本文はそのまま出す(要約しない) ──────────────
  const feedbackBlock =
    feedback == null
      ? `<p style="color:${MUTED};font-size:13px">取得できませんでした</p>`
      : voices.length === 0
        ? `<p style="color:${MUTED};font-size:13px">今週はありません</p>`
        : voices
            .map(
              (f) => `<div style="border-left:3px solid ${ACCENT};padding:2px 0 2px 10px;margin-bottom:10px">
              <div style="font-size:14px;white-space:pre-wrap">${esc(f.body || "(本文なし)")}</div>
              <div style="color:${MUTED};font-size:11px;padding-top:2px">${esc(f.at.slice(0, 10))}・v${esc(f.version || "?")}${f.contact ? "・連絡先 " + esc(f.contact) : ""}</div>
            </div>`
            )
            .join("");

  // ── 有料機能のどこを触ったか。上位3つだけ ────────────────
  const wantedLine =
    locked == null || locked.length === 0
      ? null
      : locked.slice(0, 3).map((l) => `${esc(FEATURE_LABEL[l[0]] || l[0] || "不明")} ${jp(l[1])}`).join(" / ");

  // ── 課金までの流れ(日本・直近30日に使い始めた人・人数) ──────────
  const f = funnelRows?.[0];
  const funnelLine =
    f && num(f[0]) > 0
      ? [
          ["はじめて", f[0]],
          ["1件登録", f[1]],
          ["3件", f[2]],
          ["ロック", f[3]],
          ["プラン画面", f[4]],
          ["購入開始", f[5]],
          ["お試し・購入", f[6]],
        ]
          .map(([label, n]) => `${label} ${jp(n)}`)
          .join(" → ")
      : null;

  // ── 今週の動き。1以上あるものだけ1行に ────────────────────
  const moves = [
    ...ACTIONS.map(([ev, label]) => [label, num(pick(ev7, ev)[1]), "件"]),
    ...PEOPLE.map(([ev, label]) => [label, num(pick(ev7, ev)[2]), "人"]),
  ].filter(([, n]) => n > 0);
  const movesLine = ev7 == null || moves.length === 0 ? null : moves.map(([label, n, unit]) => `${label} ${jp(n)}${unit}`).join(" / ");

  const html = `
<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;color:${INK};line-height:1.7">
  <div style="border-bottom:3px solid ${ACCENT};padding-bottom:6px;margin-bottom:12px">
    <div style="font-size:17px;font-weight:bold">📒 せどり帳 週次レポート</div>
    <div style="font-size:12px;color:${MUTED}">${range}</div>
  </div>
  ${degraded ? `<p style="background:#FDF3F1;border:1px solid ${DOWN};color:${DOWN};font-size:12px;padding:8px 10px;margin:0 0 12px">⚠ 一部の数字を取得できませんでした。0と出ていても実際は不明です。</p>` : ""}

  ${storageWarn ? `<p style="background:#FDF3F1;border:1px solid ${DOWN};color:${DOWN};font-size:12px;padding:8px 10px;margin:0 0 12px">⚠ 写真共有の画像が 800MB を超えました(無料枠 1GB)。Supabase を Pro($25/月)にするか、公式サイトの設定JSON の photoUploadPaused を true にして送信を止めてください。</p>` : ""}
  <p style="font-size:14px;margin:0 0 12px">${summary}</p>
  ${table}
  <p style="font-size:11px;color:${MUTED};margin:6px 0 20px">${refLine}</p>

  <h3 style="font-size:14px;color:${ACCENT};margin:0 0 8px">届いた声${voices.length ? ` ${voices.length}件` : ""}</h3>
  ${feedbackBlock}
  ${businessCount ? `<p style="font-size:13px;margin:8px 0 0">お仕事・コラボのご相談 <b>${businessCount}件</b>(中身は届いたときのメールで)</p>` : ""}

  ${movesLine ? `<h3 style="font-size:14px;color:${ACCENT};margin:20px 0 4px">今週の動き</h3><p style="font-size:13px;margin:0">${movesLine}</p>` : ""}
  ${wantedLine ? `<h3 style="font-size:14px;color:${ACCENT};margin:20px 0 4px">有料機能で触られた場所</h3><p style="font-size:13px;margin:0">${wantedLine}</p>` : ""}
  ${funnelLine ? `<h3 style="font-size:14px;color:${ACCENT};margin:20px 0 4px">課金までの流れ(日本・直近30日に使い始めた人)</h3><p style="font-size:13px;margin:0">${funnelLine}</p>` : ""}

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
