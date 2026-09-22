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

function table(columns, rows) {
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
  SELECT person_id, min(toDate(timestamp, 'Asia/Tokyo')) AS d0
  FROM events
  WHERE event NOT IN ('$feature_flag_called', '$set')
  GROUP BY person_id`;

const monetization = async () => {
  console.log(`# せどり帳 課金分析(PostHog)  実行: ${new Date().toISOString()}  DAYS=${DAYS}`);

  await section(
    "1. 利用者の全体像",
    `SELECT count() AS 人数,
            countIf(d0 >= today() - ${DAYS}) AS 最近${DAYS}日に初めて使った人,
            countIf(d0 >= today() - 7) AS 最近7日に初めて使った人,
            min(d0) AS 最初の人の初日
     FROM (${FIRST_DAY})`,
    "「人」は端末ごとの匿名ID。再インストールすると別の人に数えられる"
  );

  await section(
    "2. 初めて使った人の推移(週ごと)",
    `SELECT toStartOfWeek(d0) AS 週, count() AS 人数
     FROM (${FIRST_DAY})
     GROUP BY 週 ORDER BY 週`
  );

  await section(
    "3. 継続率(初日を0日目として、その後に起動した人の割合)",
    `WITH f AS (${FIRST_DAY}),
     opens AS (
       SELECT person_id, toDate(timestamp, 'Asia/Tokyo') AS d
       FROM events WHERE event = 'Application Opened'
       GROUP BY person_id, d
     )
     SELECT
       count(DISTINCT f.person_id) AS 対象人数,
       countIf(DISTINCT f.person_id, o.d = f.d0 + 1) AS 翌日,
       countIf(DISTINCT f.person_id, o.d > f.d0 AND o.d <= f.d0 + 7) AS 7日以内,
       countIf(DISTINCT f.person_id, o.d > f.d0 + 7 AND o.d <= f.d0 + 30) AS 8〜30日,
       countIf(DISTINCT f.person_id, o.d > f.d0 + 30) AS 31日以降
     FROM f LEFT JOIN opens o ON o.person_id = f.person_id
     WHERE f.d0 <= today() - 8`,
    "対象は初日から8日以上たった人。8〜30日の列は初日から31日以上たった人だけで見ること"
  );

  await section(
    "3b. 継続率(初日の月ごと)",
    `WITH f AS (${FIRST_DAY}),
     opens AS (
       SELECT person_id, toDate(timestamp, 'Asia/Tokyo') AS d
       FROM events WHERE event = 'Application Opened'
       GROUP BY person_id, d
     )
     SELECT toStartOfMonth(f.d0) AS 初日の月,
       count(DISTINCT f.person_id) AS 人数,
       countIf(DISTINCT f.person_id, o.d = f.d0 + 1) AS 翌日,
       countIf(DISTINCT f.person_id, o.d > f.d0 AND o.d <= f.d0 + 7) AS 7日以内,
       countIf(DISTINCT f.person_id, o.d > f.d0 + 7 AND o.d <= f.d0 + 30) AS 8〜30日
     FROM f LEFT JOIN opens o ON o.person_id = f.person_id
     GROUP BY 初日の月 ORDER BY 初日の月`
  );

  await section(
    "4. 使い込みの深さ(起動した日数ごとの人数)",
    `SELECT multiIf(days = 1, '1日だけ', days <= 3, '2〜3日', days <= 7, '4〜7日', days <= 14, '8〜14日', '15日以上') AS 起動した日数,
            count() AS 人数
     FROM (
       SELECT person_id, count(DISTINCT toDate(timestamp, 'Asia/Tokyo')) AS days
       FROM events WHERE event = 'Application Opened' GROUP BY person_id
     )
     GROUP BY 起動した日数 ORDER BY min(days)`
  );

  await section(
    "5. 課金までの流れ(それぞれを1回以上した人の数)",
    `SELECT
       count(DISTINCT person_id) AS 全員,
       count(DISTINCT if(event = 'item_added', person_id, NULL)) AS 仕入れ登録した,
       count(DISTINCT if(event = 'item_sold', person_id, NULL)) AS 売却を記録した,
       count(DISTINCT if(event = 'profit_card_shown', person_id, NULL)) AS 利益カードを見た,
       count(DISTINCT if(event = 'import_completed', person_id, NULL)) AS 取り込みをした,
       count(DISTINCT if(event = 'ad_interstitial_shown', person_id, NULL)) AS 全画面広告を見た,
       count(DISTINCT if(event = 'plan_locked_tap', person_id, NULL)) AS ロックに触れた,
       count(DISTINCT if(event = 'paywall_shown', person_id, NULL)) AS プラン画面を見た,
       count(DISTINCT if(event = 'purchase_started', person_id, NULL)) AS 購入を始めた,
       count(DISTINCT if(event = 'purchase_completed', person_id, NULL)) AS 購入した
     FROM events`
  );

  await section(
    "5b. 仕入れ登録の件数ごとの人数(何件入れた人がどれだけいるか)",
    `SELECT multiIf(n = 0, '0件', n <= 2, '1〜2件', n <= 9, '3〜9件', n <= 29, '10〜29件', '30件以上') AS 登録件数,
            count() AS 人数
     FROM (
       SELECT f.person_id, countIf(e.event = 'item_added') AS n
       FROM (${FIRST_DAY}) f LEFT JOIN events e ON e.person_id = f.person_id
       GROUP BY f.person_id
     )
     GROUP BY 登録件数 ORDER BY min(n)`
  );

  await section(
    "6. ロックに触れた機能(回数と人数)",
    `SELECT properties.feature AS 機能, count() AS 回数, count(DISTINCT person_id) AS 人数
     FROM events WHERE event = 'plan_locked_tap'
     GROUP BY 機能 ORDER BY 人数 DESC`
  );

  await section(
    "7. プラン画面が開いたきっかけ(回数と人数)",
    `SELECT properties.source AS きっかけ, count() AS 回数, count(DISTINCT person_id) AS 人数
     FROM events WHERE event = 'paywall_shown'
     GROUP BY きっかけ ORDER BY 人数 DESC`
  );

  await section(
    "8. 初日からプラン画面を初めて見るまでの日数",
    `SELECT multiIf(dd = 0, '初日', dd <= 3, '1〜3日後', dd <= 7, '4〜7日後', dd <= 30, '8〜30日後', '31日以降') AS 何日後,
            count() AS 人数
     FROM (
       SELECT f.person_id, dateDiff('day', f.d0, min(toDate(e.timestamp, 'Asia/Tokyo'))) AS dd
       FROM (${FIRST_DAY}) f JOIN events e ON e.person_id = f.person_id
       WHERE e.event = 'paywall_shown'
       GROUP BY f.person_id, f.d0
     )
     GROUP BY 何日後 ORDER BY min(dd)`
  );

  await section(
    "9. プラン画面を見た人のその後(見た回数と、購入を始めたか)",
    `SELECT
       count() AS プラン画面を見た人,
       countIf(views >= 2) AS 2回以上見た人,
       countIf(started > 0) AS 購入を始めた人,
       countIf(done > 0) AS 購入した人
     FROM (
       SELECT person_id,
              countIf(event = 'paywall_shown') AS views,
              countIf(event = 'purchase_started') AS started,
              countIf(event = 'purchase_completed') AS done
       FROM events GROUP BY person_id HAVING views > 0
     )`
  );

  await section(
    "10. 全画面広告(見た回数の分布)",
    `SELECT multiIf(n = 0, '0回', n <= 2, '1〜2回', n <= 5, '3〜5回', '6回以上') AS 見た回数, count() AS 人数
     FROM (
       SELECT f.person_id, countIf(e.event = 'ad_interstitial_shown') AS n
       FROM (${FIRST_DAY}) f LEFT JOIN events e ON e.person_id = f.person_id
       GROUP BY f.person_id
     )
     GROUP BY 見た回数 ORDER BY min(n)`,
    "新規インストールから14日は全画面を出さない設計。0回の人が多いのはそのため"
  );

  await section(
    "11. 使われた機能(人数)",
    `SELECT event AS 機能, count(DISTINCT person_id) AS 人数, count() AS 回数
     FROM events
     WHERE event IN ('item_added','item_sold','expense_added','csv_exported','kobutsu_csv_exported','import_completed','import_undone',
                     'share_posted','share_saved','tell_friend_tapped','review_requested','review_page_opened','lang_changed',
                     'care_card_shown','profit_card_shown','feedback')
     GROUP BY 機能 ORDER BY 人数 DESC`
  );

  await section(
    "12. 国(人数)",
    `SELECT properties.$geoip_country_code AS 国, count(DISTINCT person_id) AS 人数
     FROM events GROUP BY 国 ORDER BY 人数 DESC LIMIT 12`
  );

  await section(
    "13. OS(人数)",
    `SELECT properties.$os_name AS OS, count(DISTINCT person_id) AS 人数
     FROM events WHERE event = 'Application Opened' GROUP BY OS ORDER BY 人数 DESC`
  );

  await section(
    "14. 言語の切り替え(人数)",
    `SELECT properties.lang AS 言語, count(DISTINCT person_id) AS 人数
     FROM events WHERE event = 'lang_changed' GROUP BY 言語 ORDER BY 人数 DESC`
  );

  await section(
    "15. 今週と先週の起動人数",
    `SELECT toStartOfWeek(toDate(timestamp, 'Asia/Tokyo')) AS 週, count(DISTINCT person_id) AS 起動した人
     FROM events WHERE event = 'Application Opened' AND timestamp >= now() - interval 8 week
     GROUP BY 週 ORDER BY 週`
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
