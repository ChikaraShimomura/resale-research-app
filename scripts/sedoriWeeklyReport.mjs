// せどり帳 週次レポートメール(個人用cron)。毎週月曜の朝、直近7日をまとめて送る。
// データ源:
//   - PostHog (us.posthog.com project 538873): HogQL query API。要 POSTHOG_API_KEY(personal API key・query:read)
//   - iTunes Lookup: 認証不要の公開情報(公開中の版と評価)
//   - Supabase(任意): 届いた声(2.2.0〜)と写真共有の使用量
// 送信は Resend。RESEND_API_KEY 未設定 or `--dry` ならプレビューのみ(非破壊)。
// env: POSTHOG_API_KEY / RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可)
//      SEDORI_SUPABASE_URL / SEDORI_SUPABASE_ANON_KEY / SEDORI_INQUIRY_TOKEN(3つ揃ったときだけ読む)
//
// 方針(2026-10-27 オーナー「ほんまに重要な情報のみを一目で」):
//   1) 数字は 4 つだけ(使った人・はじめての人・7日継続・お試し/購入)
//   2) 「気になること」= 減った・下がった・0件・不具合らしい声・容量超え などがあるときだけ出す
//   3) 届いた声は 1 行ずつ(全文は届いたときのメールにある)
//   4) 売却・海外・月間・OS・公開中の版は、いちばん下に小さく
//   個々のクエリが落ちてもメールは必ず届かせる(落ちた所は「—」にして、気になることに断りを出す)。
//
// 見た目の確認(鍵なし): node scripts/sedoriWeeklyReport.mjs --sample > out.html
//   (固定の見本データで HTML を出す。PostHog にも Resend にもつながない)

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 週次レポート <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
const SAMPLE = process.argv.includes("--sample");
const DRY = SAMPLE || process.argv.includes("--dry") || !RESEND_API_KEY;

const PH_HOST = "https://us.posthog.com";
const PH_PROJECT = 538873;
const APP_ID = "6793951342";

// お問い合わせ(2.2.0〜)。3つ揃ったときだけ読む(未設定なら PostHog の feedback だけ)
const SB_URL = process.env.SEDORI_SUPABASE_URL || "";
const SB_ANON = process.env.SEDORI_SUPABASE_ANON_KEY || "";
const INQUIRY_TOKEN = process.env.SEDORI_INQUIRY_TOKEN || "";

/** 800MB を超えたら件名と「気になること」で知らせる(無料枠 1GB の手前) */
const STORAGE_WARN_BYTES = 800 * 1024 * 1024;

// purchase_completed の product。iOS は商品ID、Android は「商品ID:基本プランID」
const PRODUCT_LABEL = (id) => {
  const s = String(id || "");
  if (!s) return "?";
  const os = s.includes(":") ? "Android" : "iOS";
  const period = /year/i.test(s) ? "年額" : /month/i.test(s) ? "月額" : s;
  return `${os}・${period}`;
};

// 届いた声のうち「不具合の報告かもしれない」もの(「気になること」に件数を出し、声に印を付ける)。
// 要望と不具合を機械で分けるのは無理なので、よくある語で広めに拾う(見逃しより拾いすぎの側)
const BUG_WORDS = /不具合|バグ|エラー|落ち|消え|できない|できません|出来ない|出来ません|表示されない|変わらない|動かない|おかしい|反映されない|開かない|保存されない|crash|bug|error|broken|not work|doesn't|does not|can't|cannot|無法|不能|閃退|오류|버그|안 ?됩니다|lỗi|không (?:được|hoạt động)|ไม่ได้|บั๊ก|erro|falha|no funciona|não funciona/i;

const INK = "#2D323B";
const ACCENT = "#3D5166";
const UP = "#1E8E5A";
const DOWN = "#C7503A";
const MUTED = "#8A8F98";
const LINE = "#E6E8EC";

if (!POSTHOG_API_KEY && !SAMPLE) {
  console.error("POSTHOG_API_KEY がありません(見本を出すなら --sample)");
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

/** 候補クエリを順に試し、全部ダメなら null(=その数字だけ「—」にする) */
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

/** 前週比。0なら±0をグレーで */
function delta(now, prev) {
  const d = num(now) - num(prev);
  if (d === 0) return `<span style="color:${MUTED}">±0</span>`;
  const color = d > 0 ? UP : DOWN;
  return `<span style="color:${color}">${d > 0 ? "+" : "−"}${jp(Math.abs(d))}</span>`;
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

/** 公開中の版と評価。失敗は null */
async function fetchAppStore() {
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${APP_ID}&country=jp`, { signal: AbortSignal.timeout(15000) });
    const a = (await r.json()).results?.[0];
    if (!a) return null;
    return {
      version: String(a.version || ""),
      rating: a.averageUserRating ? Number(a.averageUserRating) : null,
      ratingCount: Number(a.userRatingCount) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * PostHog から今週の数字を取る。返り値は render() の入力(取れなかった所は null)。
 */
async function fetchData() {
  // 集計窓 = 直近7日。前週比のため 14〜7日前 も取る
  // RevenueCat → PostHog 連携(2.2.0〜)がサーバーから送るイベント(接頭辞は全部 rc_)。
  // アプリを開いていない人が「使った人」「継続」に化けるので必ず外す
  const NOTRC = "not startsWith(event, 'rc_')";
  const W = `timestamp >= now() - interval 7 day and ${NOTRC}`;
  const P = `timestamp >= now() - interval 14 day and timestamp < now() - interval 7 day and ${NOTRC}`;

  // 日本の利用者の「初日」(JST)。継続率は日本だけで見る
  // (米国は Apple/Google の審査端末が多く、ビルドのたびに新しい人として数えられるため)
  const JP_FIRST = `(select person_id, min(toDate(toTimeZone(timestamp, 'Asia/Tokyo'))) as d0 from events where properties.$geoip_country_code = 'JP' and ${NOTRC} group by person_id)`;
  // 7日継続: 初日から7〜13日目に一度でも使った人の割合。対象は初日が a〜b 日前の人(13日目まで見終わった人だけ)
  const d7 = (a, b) => `select count() as cohort, countIf(back > 0) as kept from (
      select f.person_id as pid,
        countIf(toDate(toTimeZone(e.timestamp, 'Asia/Tokyo')) >= f.d0 + 7 and toDate(toTimeZone(e.timestamp, 'Asia/Tokyo')) <= f.d0 + 13) as back
      from ${JP_FIRST} as f join events as e on e.person_id = f.person_id
      where f.d0 >= today() - ${b} and f.d0 <= today() - ${a} and e.timestamp >= now() - interval ${b + 2} day and not startsWith(e.event, 'rc_')
      group by f.person_id)`;

  // OS(iOS / Android)。人ごとに、platform が入っている一番新しいイベントの値を採る。
  // platform はアプリ 2.2.0(2026-09-22)から付くので、それ以前しか使っていない人は 'unknown'。
  // properties.platform は欠損時 NULL になるので coalesce で String に落としてから渡す
  const PLAT = "lower(toString(properties.platform))";
  const PLAT_OK = `ifNull(${PLAT} in ('ios', 'android', 'web'), 0)`;
  const OS_PICK = `coalesce(nullIf(argMaxIf(coalesce(${PLAT}, ''), timestamp, ${PLAT_OK}), ''), 'unknown')`;
  // 第2候補(argMaxIf が使えないとき)。person_id はほぼ端末ごとなので結果は同じになる
  const OS_PICK_ALT = `multiIf(countIf(ifNull(${PLAT} = 'android', 0)) > 0, 'android', countIf(ifNull(${PLAT} = 'ios', 0)) > 0, 'ios', countIf(ifNull(${PLAT} = 'web', 0)) > 0, 'web', 'unknown')`;
  const osQuery = (pick) => `select os, countIf(ev7 > 0) as u7
    from (
      select person_id, ${pick} as os, countIf(timestamp >= now() - interval 7 day) as ev7
      from events where ${NOTRC} group by person_id)
    group by os`;

  const [users7Rows, usersPrevRows, users30Rows, newUserRows, d7Rows, d7PrevRows, soldRows, purchases, feedback, countryRows, osRows] =
    await Promise.all([
      tryQuery(`select uniq(person_id) from events where ${W}`),
      tryQuery(`select uniq(person_id) from events where ${P}`),
      tryQuery(`select uniq(person_id) from events where timestamp >= now() - interval 30 day and ${NOTRC}`),
      // 今週はじめて使った人
      tryQuery(
        `select count() from (select person_id, min(timestamp) as fs from events where ${NOTRC} group by person_id having fs >= now() - interval 7 day)`,
        `select uniq(person_id) from (select person_id, min(timestamp) as fs from events where ${NOTRC} group by person_id) where fs >= now() - interval 7 day`
      ),
      // 7日継続(日本)。今回=初日が2〜4週前の人、比較=4〜6週前の人
      tryQuery(d7(14, 27)),
      tryQuery(d7(28, 41)),
      // 売却(今週・先週)と、購入をやめた人(今週)
      tryQuery(`select countIf(event = 'item_sold' and timestamp >= now() - interval 7 day) as s7,
          countIf(event = 'item_sold' and timestamp < now() - interval 7 day) as s14,
          uniqIf(person_id, event = 'purchase_cancelled' and timestamp >= now() - interval 7 day) as cancelled
        from events where timestamp >= now() - interval 14 day and ${NOTRC}`),
      tryQuery(`select timestamp, properties.product from events where event = 'purchase_completed' and ${W} order by timestamp desc limit 50`),
      tryQuery(`select timestamp, properties.message, properties.contact, properties.version from events where event = 'feedback' and ${W} order by timestamp desc limit 50`),
      // 国別。PostHogがIPから付ける $geoip_country_code
      tryQuery(
        `select coalesce(nullIf(properties.$geoip_country_code, ''), '?') as cc, uniq(person_id) as u from events where ${W} group by cc order by u desc`,
        `select properties['$geoip_country_code'] as cc, uniq(person_id) as u from events where ${W} group by cc order by u desc`
      ),
      tryQuery(osQuery(OS_PICK), osQuery(OS_PICK_ALT)),
    ]);

  const [appStore, inquiries, storage] = await Promise.all([fetchAppStore(), fetchInquiries(), fetchStorageUsage()]);

  const pct = (rows) => {
    const c = num(rows?.[0]?.[0]);
    const k = num(rows?.[0]?.[1]);
    return rows != null && c > 0 ? { c, k, p: Math.round((k / c) * 100) } : null;
  };
  const one = (rows) => (rows == null ? null : num(rows[0]?.[0]));

  // 届いた声 = 2.1.0 以前(PostHog・本文あり)+ 2.2.0〜(Supabase・kind=feedback)
  const voices =
    feedback == null && inquiries == null
      ? null
      : [
          ...(feedback || [])
            .filter((f) => String(f[1] ?? "").trim() !== "")
            .map((f) => ({ at: String(f[0]), body: String(f[1]), version: f[3] })),
          ...(inquiries || [])
            .filter((q) => q.kind === "feedback")
            .map((q) => ({ at: String(q.created_at), body: String(q.body ?? ""), version: q.app_version })),
        ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const osOf = (key) => {
    const r = (osRows || []).find((x) => String(x[0] ?? "") === key);
    return r == null ? 0 : num(r[1]);
  };

  return {
    users7: one(users7Rows),
    usersPrev: one(usersPrevRows),
    users30: one(users30Rows),
    newUsers: one(newUserRows),
    d7Now: pct(d7Rows),
    d7Prev: pct(d7PrevRows),
    d7Failed: d7Rows == null,
    sold: soldRows == null ? null : num(soldRows[0]?.[0]),
    soldPrev: soldRows == null ? null : num(soldRows[0]?.[1]),
    cancelled: soldRows == null ? 0 : num(soldRows[0]?.[2]),
    // purchase_completed はお試し開始でも出る(お試し中も有料扱い)。本当の課金は RevenueCat 側で見る
    purchases: purchases == null ? null : purchases.map((x) => PRODUCT_LABEL(x[1])),
    countries: countryRows == null ? null : countryRows.map((r) => [String(r[0] ?? "?"), num(r[1])]),
    os: osRows == null ? null : { ios: osOf("ios"), android: osOf("android"), web: osOf("web") },
    voices,
    businessCount: (inquiries || []).filter((q) => q.kind === "business").length,
    appStore,
    storage,
  };
}

/** 見本(--sample)。2026-10-20〜26 の実際の数字に近い値 */
function sampleData() {
  return {
    users7: 248,
    usersPrev: 202,
    users30: 480,
    newUsers: 107,
    d7Now: { c: 99, k: 50, p: 51 },
    d7Prev: { c: 100, k: 42, p: 42 },
    d7Failed: false,
    sold: 901,
    soldPrev: 610,
    cancelled: 1,
    purchases: Array(8).fill("iOS・月額"),
    countries: [["JP", 150], ["US", 33], ["VN", 13], ["CN", 9], ["TW", 2]],
    os: { ios: 210, android: 37, web: 1 },
    voices: [
      { at: "2026-10-26T09:23:00Z", body: "売り上げ金額の合計を(販売手数料＋送料)を差し引いた額にして欲しい。", version: "2.7.0" },
      { at: "2026-10-25T07:59:00Z", body: "便利に使わせてもらってます！\nまた幾つかの要望がありまして、売り上げ登録をすると仕入先が消えてしまう点の改善と、素早く商品を探すためにインデックス表示出来れば理想です", version: "2.5.1" },
      { at: "2026-10-24T22:08:00Z", body: "・登録後も仕入れる人を選択できるように\n・仕入れ一覧で販売予定価格が一目でわかるように", version: "2.7.0" },
      { at: "2026-10-23T12:37:00Z", body: "I love this app thank you so much", version: "2.5.1" },
      { at: "2026-10-23T11:05:00Z", body: "送料を入れるときにテンプレートが欲しいです", version: "2.5.0" },
      { at: "2026-10-23T07:08:00Z", body: "その都度要望聞いていただき大変助かってます\n日々使いやすくなっています！\n追加なんですが、Android端末でカテゴリー分けしたフラグの色が変わらない症状がありますので改善希望です", version: "2.5.1" },
      { at: "2026-10-22T15:40:00Z", body: "希望能添加字號選擇。", version: "2.5.0" },
    ],
    businessCount: 0,
    appStore: { version: "2.7.0", rating: 4.7, ratingCount: 12 },
    storage: { files: 245, bytes: 128.9 * 1024 * 1024, ledgers: 7 },
  };
}

/** 声の 1 行目(長ければ切る) */
function oneLine(body, max = 46) {
  const first = String(body || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "(本文なし)";
  const chars = [...first];
  return chars.length > max ? chars.slice(0, max).join("") + "…" : first;
}

function render(d) {
  const end = jstDate();
  const start = jstDate(new Date(Date.now() - 6 * 86400 * 1000));
  const range = `${fmtMD(start)}〜${fmtMD(end)}`;

  const users7 = d.users7;
  const paid = d.purchases == null ? null : d.purchases.length;
  const storageWarn = d.storage != null && d.storage.bytes >= STORAGE_WARN_BYTES;
  // 大事な数字のどれかが取れていない(0 と読み違えないよう断る)
  const degraded = users7 == null || d.usersPrev == null || d.newUsers == null || d.d7Failed || paid == null || d.voices == null;

  // 海外 = 国が取れていて日本以外。不明(?)は母数から外す
  const known = (d.countries || []).filter((r) => r[0] && r[0] !== "?");
  const overseasRows = known.filter((r) => r[0] !== "JP").sort((a, b) => b[1] - a[1]);
  const overseas = overseasRows.reduce((n, r) => n + r[1], 0);
  const overseasTop = overseasRows.slice(0, 3).map((r) => `${cname(r[0])} ${jp(r[1])}`).join("・");

  const bugVoices = (d.voices || []).filter((v) => BUG_WORDS.test(v.body));

  // ── 気になること。該当するものだけ。なければ「特にありません」 ─────────
  const concerns = [];
  if (degraded) concerns.push({ level: "warn", text: "一部の数字を取得できませんでした(「—」の所。0 ではありません)" });
  if (storageWarn)
    concerns.push({
      level: "warn",
      text: `写真共有の画像が ${(d.storage.bytes / 1024 / 1024).toFixed(0)}MB(無料枠 1GB)。Supabase を Pro にするか、設定JSON の photoUploadPaused を true に`,
    });
  if (users7 != null && d.usersPrev != null && d.usersPrev >= 20) {
    const drop = d.usersPrev - users7;
    if (drop > 0 && drop / d.usersPrev >= 0.1) concerns.push({ level: "warn", text: `使った人が先週より ${jp(drop)}人(${Math.round((drop / d.usersPrev) * 100)}%)減りました` });
  }
  if (d.d7Now && d.d7Prev && d.d7Prev.p - d.d7Now.p >= 5) concerns.push({ level: "warn", text: `7日継続が ${d.d7Prev.p}% → ${d.d7Now.p}% に下がりました` });
  if (paid === 0 && users7 != null && users7 >= 50) concerns.push({ level: "warn", text: "お試し・購入が 0 件でした" });
  if (d.cancelled > 0) concerns.push({ level: "info", text: `購入の途中でやめた人 ${jp(d.cancelled)}人` });
  if (bugVoices.length > 0) concerns.push({ level: "warn", text: `不具合の報告かもしれない声 ${bugVoices.length}件(下の ● の声)` });
  if (d.businessCount > 0) concerns.push({ level: "info", text: `お仕事・コラボのご相談 ${d.businessCount}件(中身は届いたときのメールで)` });

  // ── 件名: 開かなくても分かるように ─────────────────────────
  const subjectBase = `せどり帳 週次 ${range}｜使った人${users7 == null ? "—" : jp(users7)}・7日継続${d.d7Now ? d.d7Now.p + "%" : "—"}・お試し/購入${paid == null ? "—" : paid}`;
  const subject = storageWarn ? `⚠画像が800MB超 ${subjectBase}` : degraded ? `⚠一部取得できず ${subjectBase}` : subjectBase;

  const cell = (label, value, sub, color = INK) => `<td width="25%" align="center" valign="top" style="padding:12px 2px 10px;border:1px solid ${LINE};background:#FAFBFC">
      <div style="font-size:11px;color:${MUTED};white-space:nowrap">${label}</div>
      <div style="font-size:24px;font-weight:bold;color:${color};padding:2px 0;white-space:nowrap">${value}</div>
      <div style="font-size:11px;color:${MUTED};white-space:nowrap">${sub || "&nbsp;"}</div>
    </td>`;
  const table = `<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
    <tr>
      ${cell("使った人", users7 == null ? "—" : jp(users7), users7 == null || d.usersPrev == null ? "" : `先週比 ${delta(users7, d.usersPrev)}`)}
      ${cell("はじめての人", d.newUsers == null ? "—" : jp(d.newUsers), "")}
      ${cell("7日継続", d.d7Now ? `${d.d7Now.p}%` : "—", d.d7Now && d.d7Prev ? `前回 ${d.d7Prev.p}%` : d.d7Now ? `${jp(d.d7Now.c)}人中${jp(d.d7Now.k)}人` : "")}
      ${cell("お試し・購入", paid == null ? "—" : jp(paid), paid ? esc([...new Set(d.purchases)].join(" / ")) : "", paid ? UP : INK)}
    </tr>
  </table>`;

  const concernBlock =
    concerns.length === 0
      ? `<p style="font-size:13px;color:${UP};margin:0">特にありません</p>`
      : `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">${concerns
          .map((c) => `<li style="color:${c.level === "warn" ? DOWN : INK}">${esc(c.text)}</li>`)
          .join("")}</ul>`;

  // ── 届いた声。1 行ずつ(全文は届いたときのメールにある) ────────────────
  const voiceBlock =
    d.voices == null
      ? `<p style="color:${MUTED};font-size:13px;margin:0">取得できませんでした</p>`
      : d.voices.length === 0
        ? `<p style="color:${MUTED};font-size:13px;margin:0">今週はありません</p>`
        : `<table cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.7">${d.voices
            .map(
              (v) => `<tr>
                <td valign="top" style="padding-right:6px;color:${BUG_WORDS.test(v.body) ? DOWN : LINE}">●</td>
                <td valign="top">${esc(oneLine(v.body))} <span style="color:${MUTED};font-size:11px;white-space:nowrap">${esc(v.at.slice(5, 10).replace("-", "/"))}・v${esc(v.version || "?")}</span></td>
              </tr>`
            )
            .join("")}</table>`;

  // ── 参考。小さく 2 行まで ─────────────────────────────
  const ref1 = [
    d.sold == null ? null : `売却 ${jp(d.sold)}件${d.soldPrev == null ? "" : `(${delta(d.sold, d.soldPrev)})`}`,
    d.countries == null || known.length === 0 ? null : `海外 ${jp(overseas)}人${overseasTop ? `(${overseasTop})` : ""}`,
    d.users30 == null ? null : `月間 ${jp(d.users30)}人`,
  ].filter(Boolean);
  const ref2 = [
    d.os == null ? null : `iOS ${jp(d.os.ios)}・Android ${jp(d.os.android)}${d.os.web ? `・ブラウザ ${jp(d.os.web)}` : ""}`,
    d.appStore == null
      ? null
      : `公開中 v${esc(d.appStore.version)}${d.appStore.rating ? ` ★${d.appStore.rating.toFixed(1)}(${jp(d.appStore.ratingCount)}件)` : ""}`,
    d.storage == null ? null : `共有画像 ${(d.storage.bytes / 1024 / 1024).toFixed(0)}MB/1GB`,
  ].filter(Boolean);

  const h3 = (text) => `<h3 style="font-size:13px;color:${ACCENT};margin:18px 0 6px;letter-spacing:.5px">${text}</h3>`;

  const html = `
<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;color:${INK};line-height:1.6">
  <div style="border-bottom:3px solid ${ACCENT};padding-bottom:6px;margin-bottom:12px">
    <span style="font-size:17px;font-weight:bold">📒 せどり帳 週次</span>
    <span style="font-size:13px;color:${MUTED};padding-left:8px">${range}</span>
  </div>
  ${table}

  ${h3(concerns.length === 0 ? "気になること" : `気になること ${concerns.length}件`)}
  ${concernBlock}

  ${h3(`届いた声${d.voices?.length ? ` ${d.voices.length}件` : ""}`)}
  ${voiceBlock}

  <p style="color:${MUTED};font-size:11px;line-height:1.7;padding-top:10px;margin:22px 0 0;border-top:1px solid ${LINE}">
    ${ref1.join(" ／ ")}${ref2.length ? `<br>${ref2.join(" ／ ")}` : ""}
  </p>
</div>`;

  return { subject, html };
}

async function main() {
  const data = SAMPLE ? sampleData() : await fetchData();
  const { subject, html } = render(data);

  if (DRY) {
    if (SAMPLE) {
      // そのままブラウザで開ける形で出す
      console.log(`<!doctype html><meta charset="utf-8"><title>${esc(subject)}</title><body style="background:#fff;padding:16px">${html}</body>`);
      return;
    }
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
