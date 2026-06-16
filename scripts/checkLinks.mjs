#!/usr/bin/env node
// scripts/checkLinks.mjs — 日次リンク死活チェック（GitHub Actions, 03:45 JST 想定）
//
// 目的: 利益商品カタログ(profitable_products)の各商品について、仕入れ元の楽天商品が
//       まだ掲載されているか(リンクが生きているか)を1日1回確認し、掲載終了(出品取り下げ/
//       商品削除)されたものをカタログから除外する。初心者が「楽天で仕入れる」を押して
//       消えた商品ページに飛ぶ事故を防ぐ。
//
// なぜHTTPステータスではなく楽天APIで判定するか:
//   source.url は基本アフィリエイトURL(affiliateUrl)で、商品が消えてもアフィリゲートウェイは
//   200を返しがち＝HTTP状態では死活を正しく判定できない。商品ID(=楽天itemCode)で
//   Ichiba商品検索APIに問い合わせ、「商品が在るか/無いか」で権威的に判定する(ToS順守・構造化)。
//   楽天仕様: 掲載終了/存在しない itemCode は 404 + {error:"not_found"} を返す。
//
// 安全側の原則(誤削除は復活しにくくコストが高いため徹底):
//   ① not_found のみ dead。429/5xx/タイムアウト/その他エラーは「不明」として残す(fail-safe)。
//   ② dead判定は1度だけ再確認してから確定(楽天側の一時的な揺れで生存商品を消さない)。
//   ③ 1回で総数の SAFETY_MAX_PRUNE_RATE 超を消しそうな時は楽天障害とみなし書き戻し中止(安全ブレーキ)。
//   ④ 書き戻し直前にカタログを再取得し dead だけを除外＝チェック中に refresh が走っても新商品を潰さない。

// ========== 設定 ==========
const RAKUTEN_APP_ID       = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY   = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const KV_URL               = process.env.KV_REST_API_URL;
const KV_TOKEN             = process.env.KV_REST_API_TOKEN;

const RAKUTEN_GAP_MS        = Number(process.env.RAKUTEN_GAP_MS ?? 1100);      // 楽天APIは~1req/secが目安。直列+間隔で順守。
const SAFETY_MAX_PRUNE_RATE = Number(process.env.LINK_PRUNE_MAX_RATE ?? 0.4);  // これ超の削除は障害とみなし中止
const CATALOG_TTL_SEC       = 480 * 3600;                                      // refresh.mjs と同じ(20日)。書き戻しでTTLを縮めない。

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ========== Upstash KV（refresh.mjs と同方式: 生REST fetch） ==========
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    if (!data.result) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch { return null; }
}

async function kvSet(key, value, exSeconds = 86400) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]]),
    });
  } catch (e) { console.error('kvSet error:', e.message); }
}

async function kvDel(key) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['DEL', key]]),
    });
  } catch (e) { console.error('kvDel error:', e.message); }
}

async function kvHdel(key, field) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['HDEL', key, field]]),
    });
  } catch (e) { console.error('kvHdel error:', e.message); }
}

// ========== 楽天 itemCode 死活判定 ==========
// 戻り値: 'alive'（掲載中） | 'dead'（掲載終了） | 'unknown'（判定不能＝残す）
async function checkRakutenItem(itemCode) {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    itemCode,            // "shop:1234" 形式。これ単体で厳密一致の存在確認になる。
    hits: '1',
    format: 'json',
  });
  try {
    const res = await fetch(
      `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`,
      {
        headers: {
          Referer: 'https://www.yushutsu-fukugyo.com/',
          Origin: 'https://www.yushutsu-fukugyo.com',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    let data = null;
    try { data = await res.json(); } catch { /* 非JSON応答 */ }

    // 掲載終了/存在しない itemCode は 404 + {error:"not_found"}（楽天仕様）→ dead
    if (data && data.error === 'not_found') return 'dead';
    // 正常応答: itemCode厳密一致で 0件 でも掲載終了扱い（防御的）
    if (res.ok && data && Array.isArray(data.Items)) {
      return data.Items.length > 0 ? 'alive' : 'dead';
    }
    // それ以外（too_many_requests / wrong_parameter / 5xx / 非JSON 等）→ 不明（残す）
    return 'unknown';
  } catch {
    return 'unknown'; // タイムアウト/ネットワーク → 不明（残す）
  }
}

// dead は誤削除コストが高いので、1度だけ再確認してから確定する（揺れたら残す側に倒す）。
async function confirmStatus(itemCode) {
  const first = await checkRakutenItem(itemCode);
  if (first !== 'dead') return first;
  await sleep(1500);
  const second = await checkRakutenItem(itemCode);
  return second; // 2回連続 dead のときだけ dead
}

// ========== メイン ==========
async function main() {
  if (!KV_URL || !KV_TOKEN || !RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) {
    console.error('必須env未設定 (KV_REST_API_URL / KV_REST_API_TOKEN / RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY)。中止。');
    process.exit(1);
  }
  const startedAt = Date.now();

  const products = await kvGet('profitable_products');
  if (!Array.isArray(products) || products.length === 0) {
    console.log('カタログが空 or 取得失敗。何もしない。');
    return;
  }
  console.log(`リンク死活チェック開始: ${products.length}件 (gap ${RAKUTEN_GAP_MS}ms)`);

  const deadIds = [];
  let alive = 0, unknown = 0;
  for (const p of products) {
    const code = p?.id;
    if (!code) { unknown++; continue; } // IDなし=判定不能 → 残す
    const status = await confirmStatus(code);
    if (status === 'dead') deadIds.push(code);
    else if (status === 'alive') alive++;
    else unknown++;
    await sleep(RAKUTEN_GAP_MS);
  }

  const pruneRate = deadIds.length / products.length;
  const aborted = deadIds.length > 0 && pruneRate > SAFETY_MAX_PRUNE_RATE;
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  // 観測用stats（常に書く）
  await kvSet('link_check_stats', {
    checkedAt: new Date().toISOString(),
    total: products.length,
    alive,
    dead: deadIds.length,
    unknown,
    prunedIds: aborted ? [] : deadIds,
    pruneRate: Math.round(pruneRate * 1000) / 1000,
    aborted,
    elapsedSec,
  }, CATALOG_TTL_SEC);

  if (aborted) {
    console.error(
      `⚠️ 安全ブレーキ作動: ${deadIds.length}/${products.length} (${Math.round(pruneRate * 100)}%) が dead 判定。` +
      `楽天障害の可能性が高いため書き戻しを中止。`
    );
    process.exit(1); // ジョブを失敗扱いにしてメール通知させる
  }

  if (deadIds.length === 0) {
    console.log(`全件生存。alive ${alive} / unknown ${unknown}（変更なし, ${elapsedSec}s）`);
    return;
  }

  // 書き戻し直前に最新カタログを再取得し、dead だけを除外（チェック中の refresh と競合しても新商品を潰さない）
  const fresh = await kvGet('profitable_products');
  const base = (Array.isArray(fresh) && fresh.length) ? fresh : products;
  const deadSet = new Set(deadIds);
  const finalList = base.filter((p) => !deadSet.has(p?.id));
  await kvSet('profitable_products', finalList, CATALOG_TTL_SEC);

  // 付随KVの掃除（SOLDライフサイクルと同じ衛生）。失敗は無視。
  for (const id of deadIds) {
    await kvDel(`listing_actors:${id}`);
    await kvHdel('sold_since', id);
  }

  console.log(
    `掲載終了を除外: ${deadIds.length}件 → カタログ ${base.length} → ${finalList.length}件 ` +
    `(alive ${alive} / unknown ${unknown}, ${elapsedSec}s)`
  );
  console.log('除外ID:', deadIds.join(', '));
}

main().catch((e) => { console.error('checkLinks fatal:', e); process.exit(1); });
