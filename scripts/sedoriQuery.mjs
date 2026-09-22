// せどり帳の分析用クエリ(PostHog HogQL)を実行して、結果を標準出力にMarkdown表で出す。
// 週次メール(sedoriWeeklyReport.mjs)と同じ鍵・同じ query API。送信はしない。
//
// 使い方(GitHub Actions の sedori-query.yml から。鍵は Secrets にしか無い):
//   PACK=monetization node scripts/sedoriQuery.mjs        … 課金分析の定型セット
//   HOGQL="SELECT ..." node scripts/sedoriQuery.mjs        … 任意の1クエリ
//   DAYS=90 … 「最近N日に初めて使った人」の絞り込みに使う(既定 90)
//
// 数字の読み方:
//   - 「人」= PostHog の person_id(端末ごとの匿名ID。機種変更や再インストールで別人になる)
//   - 「初日」= その人の最初のイベントの日(JST)。継続率は初日を0日目として数える
//   - イベント名はアプリの src/analytics.ts のもの。起動は PostHog の自動イベント "Application Opened"

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || "";
const PH_HOST = "https://us.posthog.com";
const PH_PROJECT = 538873;
const PACK = process.env.PACK || "monetization";
const HOGQL = process.env.HOGQL || "";
const DAYS = Number(process.env.DAYS) || 90;
const COUNTRY = process.env.COUNTRY || ""; // 例 JP。空なら全員
const C = COUNTRY ? ` AND properties.$geoip_country_code = '${COUNTRY}'` : "";

if (!POSTHOG_API_KEY) {
  console.error("POSTHOG_API_KEY がありません");
  process.exit(1);
}

async function hogql(query) {
  const r = await fetch(`${PH_HOST}/api/environments/${PH_PROJECT}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`PostHog ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return { columns: j.columns || [], results: j.results || [] };
}

const LABELS = {
  n_people: "人数", new_in_days: `最近${DAYS}日に初めて使った人`, new_in_7d: "最近7日に初めて使った人", first_day_min: "最初の人の初日",
  week: "週", cohort: "対象人数", d1: "翌日", within_7d: "7日以内", d8_30: "8〜30日", after_30: "31日以降", first_month: "初日の月",
  active_days: "起動した日数", all_users: "全員", added_item: "仕入れ登録した", sold_item: "売却を記録した", saw_profit_card: "利益カードを見た",
  imported: "取り込みをした", saw_interstitial: "全画面広告を見た", hit_lock: "ロックに触れた", saw_paywall: "プラン画面を見た",
  started_purchase: "購入を始めた", purchased: "購入した", items_added_bucket: "登録件数", feature: "機能", n_events: "回数", source: "きっかけ",
  days_after: "何日後", saw_paywall_people: "プラン画面を見た人", saw_twice: "2回以上見た人", started_people: "購入を始めた人",
  purchased_people: "購入した人", views_bucket: "見た回数", country: "国", lang: "言語", opened_people: "起動した人",
};

function table(cols, rows) {
  const columns = cols.map((c) => LABELS[c] || c);
  if (!rows.length) return "(0件)\n";
  const head = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((v) => (v == null ? "" : String(v))).join(" | ")} |`).join("\n");
  return `${head}\n${body}\n`;
}

async function section(title, query, note) {
  console.log(`\n## ${title}`);
  if (note) console.log(`_${note}_\n`);
  try {
    const { columns, results } = await hogql(query);
    console.log(table(columns, results));
  } catch (e) {
    console.log(`(取得できず: ${String(e.message || e).slice(0, 300)})\n`);
  }
}

// 人ごとの初日(JST)。以下のクエリで共通に使う
const FIRST_DAY = `
  SELECT person_id, min(toDate(toTimeZone(timestamp, 'Asia/Tokyo'))) AS d0
  FROM events
  WHERE event NOT IN ('$feature_flag_called', '$set')${C}
  GROUP BY person_id`;

const monetization = async () => {
  console.log(`# せどり帳 課金分析(PostHog)  実行: ${new Date().toISOString()}  DAYS=${DAYS}  国=${COUNTRY || "全部"}`);

  await section(
    "1. 利用者の全体像",
    `SELECT count() AS n_people,
            countIf(d0 >= today() - ${DAYS}) AS new_in_days,
            countIf(d0 >= today() - 7) AS new_in_7d,
            min(d0) AS first_day_min
     FROM (${FIRST_DAY})`,
    "「人」は端末ごとの匿名ID。再インストールすると別の人に数えられる"
  );

  await section(
    "2. 初めて使った人の推移(週ごと)",
    `SELECT toStartOfWeek(d0) AS week, count() AS n_people
     FROM (${FIRST_DAY})
     GROUP BY week ORDER BY week`
  );

  await section(
    "3. 継続率(初日を0日目として、その後に起動した人の割合)",
    `WITH f AS (${FIRST_DAY}),
     opens AS (
       SELECT person_id, toDate(toTimeZone(timestamp, 'Asia/Tokyo')) AS d
       FROM events WHERE event = 'Application Opened'${C}
       GROUP BY person_id, d
     )
     SELECT
       count(DISTINCT f.person_id) AS cohort,
       countIf(DISTINCT f.person_id, o.d = f.d0 + 1) AS d1,
       countIf(DISTINCT f.person_id, o.d > f.d0 AND o.d <= f.d0 + 7) AS within_7d,
       countIf(DISTINCT f.person_id, o.d > f.d0 + 7 AND o.d <= f.d0 + 30) AS d8_30,
       countIf(DISTINCT f.person_id, o.d > f.d0 + 30) AS after_30
     FROM f LEFT JOIN opens o ON o.person_id = f.person_id
     WHERE f.d0 <= today() - 8`,
    "対象は初日から8日以上たった人。8〜30日の列は初日から31日以上たった人だけで見ること"
  );

  await section(
    "3b. 継続率(初日の月ごと)",
    `WITH f AS (${FIRST_DAY}),
     opens AS (
       SELECT person_id, toDate(toTimeZone(timestamp, 'Asia/Tokyo')) AS d
       FROM events WHERE event = 'Application Opened'${C}
       GROUP BY person_id, d
     )
     SELECT toStartOfMonth(f.d0) AS first_month,
       count(DISTINCT f.person_id) AS n_people,
       countIf(DISTINCT f.person_id, o.d = f.d0 + 1) AS d1,
       countIf(DISTINCT f.person_id, o.d > f.d0 AND o.d <= f.d0 + 7) AS within_7d,
       countIf(DISTINCT f.person_id, o.d > f.d0 + 7 AND o.d <= f.d0 + 30) AS d8_30
     FROM f LEFT JOIN opens o ON o.person_id = f.person_id
     GROUP BY first_month ORDER BY first_month`
  );

  await section(
    "4. 使い込みの深さ(起動した日数ごとの人数)",
    `SELECT multiIf(days = 1, '1日だけ', days <= 3, '2〜3日', days <= 7, '4〜7日', days <= 14, '8〜14日', '15日以上') AS active_days,
            count() AS n_people
     FROM (
       SELECT person_id, count(DISTINCT toDate(toTimeZone(timestamp, 'Asia/Tokyo'))) AS days
       FROM events WHERE event = 'Application Opened'${C} GROUP BY person_id
     )
     GROUP BY active_days ORDER BY min(days)`
  );

  await section(
    "5. 課金までの流れ(それぞれを1回以上した人の数)",
    `SELECT
       count(DISTINCT person_id) AS all_users,
       count(DISTINCT if(event = 'item_added', person_id, NULL)) AS added_item,
       count(DISTINCT if(event = 'item_sold', person_id, NULL)) AS sold_item,
       count(DISTINCT if(event = 'profit_card_shown', person_id, NULL)) AS saw_profit_card,
       count(DISTINCT if(event = 'import_completed', person_id, NULL)) AS imported,
       count(DISTINCT if(event = 'ad_interstitial_shown', person_id, NULL)) AS saw_interstitial,
       count(DISTINCT if(event = 'plan_locked_tap', person_id, NULL)) AS hit_lock,
       count(DISTINCT if(event = 'paywall_shown', person_id, NULL)) AS saw_paywall,
       count(DISTINCT if(event = 'purchase_started', person_id, NULL)) AS started_purchase,
       count(DISTINCT if(event = 'purchase_completed', person_id, NULL)) AS purchased
     FROM events WHERE 1=1${C}`
  );

  await section(
    "5b. 仕入れ登録の件数ごとの人数(何件入れた人がどれだけいるか)",
    `SELECT multiIf(n = 0, '0件', n <= 2, '1〜2件', n <= 9, '3〜9件', n <= 29, '10〜29件', '30件以上') AS items_added_bucket,
            count() AS n_people
     FROM (
       SELECT f.person_id, countIf(e.event = 'item_added') AS n
       FROM (${FIRST_DAY}) f LEFT JOIN events e ON e.person_id = f.person_id
       GROUP BY f.person_id
     )
     GROUP BY items_added_bucket ORDER BY min(n)`
  );

  await section(
    "6. ロックに触れた機能(回数と人数)",
    `SELECT properties.feature AS feature, count() AS n_events, count(DISTINCT person_id) AS n_people
     FROM events WHERE event = 'plan_locked_tap'${C}
     GROUP BY feature ORDER BY n_people DESC`
  );

  await section(
    "7. プラン画面が開いたきっかけ(回数と人数)",
    `SELECT properties.source AS source, count() AS n_events, count(DISTINCT person_id) AS n_people
     FROM events WHERE event = 'paywall_shown'${C}
     GROUP BY source ORDER BY n_people DESC`
  );

  await section(
    "8. 初日からプラン画面を初めて見るまでの日数",
    `SELECT multiIf(dd = 0, '初日', dd <= 3, '1〜3日後', dd <= 7, '4〜7日後', dd <= 30, '8〜30日後', '31日以降') AS days_after,
            count() AS n_people
     FROM (
       SELECT f.person_id, dateDiff('day', f.d0, min(toDate(toTimeZone(e.timestamp, 'Asia/Tokyo')))) AS dd
       FROM (${FIRST_DAY}) f JOIN events e ON e.person_id = f.person_id
       WHERE e.event = 'paywall_shown'
       GROUP BY f.person_id, f.d0
     )
     GROUP BY days_after ORDER BY min(dd)`
  );

  await section(
    "9. プラン画面を見た人のその後(見た回数と、購入を始めたか)",
    `SELECT
       count() AS saw_paywall_people,
       countIf(views >= 2) AS saw_twice,
       countIf(started > 0) AS started_people,
       countIf(done > 0) AS purchased_people
     FROM (
       SELECT person_id,
              countIf(event = 'paywall_shown') AS views,
              countIf(event = 'purchase_started') AS started,
              countIf(event = 'purchase_completed') AS done
       FROM events WHERE 1=1${C} GROUP BY person_id HAVING views > 0
     )`
  );

  await section(
    "10. 全画面広告(見た回数の分布)",
    `SELECT multiIf(n = 0, '0回', n <= 2, '1〜2回', n <= 5, '3〜5回', '6回以上') AS views_bucket, count() AS n_people
     FROM (
       SELECT f.person_id, countIf(e.event = 'ad_interstitial_shown') AS n
       FROM (${FIRST_DAY}) f LEFT JOIN events e ON e.person_id = f.person_id
       GROUP BY f.person_id
     )
     GROUP BY views_bucket ORDER BY min(n)`,
    "新規インストールから14日は全画面を出さない設計。0回の人が多いのはそのため"
  );

  await section(
    "11. 使われた機能(人数)",
    `SELECT event AS feature, count(DISTINCT person_id) AS n_people, count() AS n_events
     FROM events
     WHERE 1=1${C} AND event IN ('item_added','item_sold','expense_added','csv_exported','kobutsu_csv_exported','import_completed','import_undone',
                     'share_posted','share_saved','tell_friend_tapped','review_requested','review_page_opened','lang_changed',
                     'care_card_shown','profit_card_shown','feedback')
     GROUP BY feature ORDER BY n_people DESC`
  );

  await section(
    "12. 国(人数)",
    `SELECT properties.$geoip_country_code AS country, count(DISTINCT person_id) AS n_people
     FROM events GROUP BY country ORDER BY n_people DESC LIMIT 12`
  );

  await section(
    "13. OS(人数)",
    `SELECT properties.$os AS OS, properties.$lib AS lib, count(DISTINCT person_id) AS n_people
     FROM events WHERE 1=1${C} GROUP BY OS, lib ORDER BY n_people DESC`
  );

  await section(
    "14. 言語の切り替え(人数)",
    `SELECT properties.lang AS lang, count(DISTINCT person_id) AS n_people
     FROM events WHERE event = 'lang_changed' GROUP BY lang ORDER BY n_people DESC`
  );

  await section(
    "15. 今週と先週の起動人数",
    `SELECT toStartOfWeek(toDate(toTimeZone(timestamp, 'Asia/Tokyo'))) AS week, count(DISTINCT person_id) AS opened_people
     FROM events WHERE event = 'Application Opened'${C} AND timestamp >= now() - interval 8 week
     GROUP BY week ORDER BY week`
  );
};

if (HOGQL) {
  await section("任意クエリ", HOGQL);
} else if (PACK === "monetization") {
  await monetization();
} else {
  console.error(`未知の PACK: ${PACK}`);
  process.exit(1);
}
