#!/usr/bin/env node
// scripts/ebaySoldWorker.mjs
// eBayの「売却済み(Sold/Completed)」ページをスクレイプし、カタログ各商品の直近落札中央値(JPY)を
// KV `ebay_sold:{productId}` に保存する。Marketplace Insights API(承認制)を待たない回避策A。
//
// 【Pixel/Termuxで動く】Chromium不要の純node fetch＋ブラウザ並みヘッダ/Cookie。eBayの403は主にIP起因＝
//   住宅IP(Pixel/このPC)で通る見込み。DC IP(GitHub Actions等)は不可。楽天死活ワーカーと同じTermux運用に乗る。
//
// 【UI変更に強くする＝多層ガード（誤データでカタログ相場を汚さない／壊れたら気づく）】
//   1) パース健全性：1商品で価格が取れない＝サンプル不足→書かない（個別スキップ）。
//   2) 値の妥当性：落札中央値が「その商品の現eBay相場(realAvgPrice)」から極端に乖離(×0.2未満/×5超)は
//      パース誤り(送料や別商品を拾った等)とみなし破棄。
//   3) 系統的失敗ブレーキ：1回の実行で 失敗率(ブロック+0件+妥当性NG) が高い＝eBayのUI変更/IPブロックの疑い
//      → その実行の書込を“全部”中止（一部の通った分も書かない＝汚染回避）＋status を unhealthy で記録。
//   4) 監視：`ebay_sold_status` に毎回サマリを残す（cron監視→メール通知に使える）。
//   5) 失効：各値は TTL(既定7日)。ワーカーが壊れて止まれば自然失効→消費側は現在出品相場へ自動フォールバック。
//
// 使い方(PowerShell/Termux・リポジトリ直下):
//   EBAY_SOLD_DRY=1 EBAY_SOLD_MAX=5 node scripts/ebaySoldWorker.mjs   # 試運転(書込なし)
//   EBAY_SOLD_DRY=0 node scripts/ebaySoldWorker.mjs                    # 本書込

import fs from "node:fs";
try {
  const envPath = new URL("../.env.local", import.meta.url);
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* env から拾えるので無視 */ }

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const H = { Authorization: `Bearer ${KV_TOKEN}` };
const USD_JPY = Number(process.env.LANDED_USD_JPY) || 155;

const DRY = process.env.EBAY_SOLD_DRY !== "0";
const MAX = Number(process.env.EBAY_SOLD_MAX ?? 60);
const GAP_MS = Number(process.env.EBAY_SOLD_GAP_MS ?? 4000);
const TTL_S = Number(process.env.EBAY_SOLD_TTL_H ?? 168) * 3600;
const FRESH_S = Number(process.env.EBAY_SOLD_FRESH_H ?? 36) * 3600;
const MIN_SAMPLE = 3;
const WINDOW_DAYS = Number(process.env.EBAY_SOLD_WINDOW_DAYS ?? 30); // 直近この日数の落札だけ採用（既定30日）
const SANE_LO = Number(process.env.EBAY_SOLD_SANE_LO ?? 0.2); // 現相場×これ未満は破棄
const SANE_HI = Number(process.env.EBAY_SOLD_SANE_HI ?? 5);   // 現相場×これ超は破棄
const BRAKE_MIN = Number(process.env.EBAY_SOLD_BRAKE_MIN ?? 5);
const BRAKE_RATIO = Number(process.env.EBAY_SOLD_BRAKE_RATIO ?? 0.6); // 失敗率これ超で全書込中止
const TEST_KW = process.env.EBAY_SOLD_TEST || ""; // 指定すると カタログでなく このキーワード1件だけ診断（パーサ検証用）
const DEBUG = process.env.EBAY_SOLD_DEBUG === "1" || !!TEST_KW; // テスト時は自動でDEBUG

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const jitterGap = () => sleep(Math.round(GAP_MS * rnd(1, 2.2)));

const cookieJar = {};
const cookieHeader = () => Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ") || undefined;
function storeCookies(res) {
  try { for (const c of res.headers.getSetCookie?.() ?? []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) cookieJar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } } catch {}
}
function browserHeaders(referer) {
  const h = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none", "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) h.Referer = referer;
  const c = cookieHeader(); if (c) h.Cookie = c;
  return h;
}

async function kvGet(key) {
  try { const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H }); const r = (await res.json()).result; if (r == null) return null; try { return JSON.parse(r); } catch { return r; } } catch { return null; }
}
async function kvSetJson(key, val, ttl) {
  try { const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(val))}?EX=${ttl}`, { method: "POST", headers: H }); return res.ok; } catch { return false; }
}

// 売却済みページを「商品カード単位」に割って、各カードの 価格 と 落札日(Sold ...) をペアで取り、
// 直近 windowDays 以内のものだけ価格を返す。日付プレースホルダ(先頭の"Shop on eBay")は日付が無いので自然に除外。
// 返り値: { prices(窓内), items(カード数), dated(日付が取れたカード数) }。
function ageDays(dateStr) { const t = Date.parse(dateStr); return Number.isNaN(t) ? null : (Date.now() - t) / 86400000; }
function parseSoldWithin(html, windowDays) {
  const chunks = html.split(/<li[^>]*class="[^"]*s-item[^"]*"/i);
  const prices = []; let dated = 0; const items = Math.max(0, chunks.length - 1);
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];
    const pm = c.match(/s-item__price[^$]{0,40}\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
    if (!pm) continue;
    const price = parseFloat(pm[1].replace(/,/g, "")); if (!(price > 0)) continue;
    let age = null;
    const dm = c.match(/Sold\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})/) || c.match(/Sold\s+(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/);
    if (dm) { age = ageDays(dm[1]); if (age != null) dated++; }
    else if (/Sold\s+Today/i.test(c)) { age = 0; dated++; }
    else if (/Sold\s+Yesterday/i.test(c)) { age = 1; dated++; }
    if (age != null && age >= -1 && age <= windowDays) prices.push(price);
  }
  return { prices, items, dated };
}
function trimmedMedian(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y); if (!a.length) return null;
  const cut = a.length >= 8 ? Math.floor(a.length * 0.1) : 0; const t = a.slice(cut, a.length - cut); const mid = Math.floor(t.length / 2);
  return { median: t.length % 2 ? t[mid] : (t[mid - 1] + t[mid]) / 2, count: a.length };
}
async function get(url, referer) {
  const res = await fetch(url, { headers: browserHeaders(referer), redirect: "follow", signal: AbortSignal.timeout(20000) });
  storeCookies(res); return { status: res.status, html: await res.text() };
}
const isBlocked = (html) => /Pardon Our Interruption|Checking your browser|verify you are a human|to continue, please|captcha/i.test(html.slice(0, 4000));

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定"); process.exit(1); }
  console.log(`eBay sold worker: DRY=${DRY} MAX=${MAX} GAP=${GAP_MS}ms USD_JPY=${USD_JPY}`);
  const catalog = TEST_KW ? [{ id: "test", coreKeyword: TEST_KW, realAvgPrice: 0 }] : ((await kvGet("profitable_products")) || []);
  if (!Array.isArray(catalog) || !catalog.length) { console.log("カタログ空"); return; }
  if (TEST_KW) console.log(`★テストモード: "${TEST_KW}"`);

  try { const w = await get("https://www.ebay.com", null); if (isBlocked(w.html)) console.log("  ⚠️ トップで検問。住宅IPでない可能性"); await sleep(Math.round(rnd(1200, 2500))); } catch {}

  const now = Math.floor(Date.now() / 1000);
  const buffer = []; // 健全な実行のときだけ最後にまとめて書く（汚染回避）
  let done = 0, blocked = 0, thin = 0, implausible = 0, dateFail = 0, ok = 0, skipped = 0;
  for (const p of catalog) {
    if (done >= MAX) break;
    const id = p?.id, kw = p?.coreKeyword || p?.title;
    if (!id || !kw) continue;
    const prev = await kvGet(`ebay_sold:${id}`);
    if (prev?.at && now - Math.floor(new Date(prev.at).getTime() / 1000) < FRESH_S) { skipped++; continue; }

    done++;
    let r;
    try { r = await get(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(kw.slice(0, 120))}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`, "https://www.ebay.com/"); }
    catch (e) { r = { status: "err:" + (e?.name || e?.message), html: "" }; }
    if (typeof r.status !== "number" || r.status >= 400) { blocked++; console.log(`  ⛔ ${r.status} : ${kw.slice(0, 40)}`); await sleep(Math.round(rnd(15000, 30000))); continue; }
    if (isBlocked(r.html)) { blocked++; console.log(`  ⛔ 検問ページ : ${kw.slice(0, 40)}`); await sleep(Math.round(rnd(30000, 60000))); continue; }

    const parsed = parseSoldWithin(r.html, WINDOW_DAYS);
    if (DEBUG && done === 1) {
      const h = r.html;
      console.log(`  [DEBUG] htmlLen=${h.length} status=${r.status} priceMarkers=${(h.match(/s-item__price/g) || []).length} 'Sold 'raw=${(h.match(/Sold\s/g) || []).length} liChunks=${h.split(/<li[^>]*class="[^"]*s-item[^"]*"/i).length - 1} hasTitle=${/s-item__title/.test(h)} noResults=${/0 results|didn't match any|No exact matches/i.test(h)}`);
      console.log(`  [DEBUG] price samples=${JSON.stringify([...h.matchAll(/s-item__price[^$]{0,40}\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g)].slice(0, 3).map((m) => m[1]))}`);
      console.log(`  [DEBUG] sold-date samples=${JSON.stringify([...h.matchAll(/Sold\s+([^<]{3,22})/g)].slice(0, 3).map((m) => m[1].trim()))}`);
      console.log(`  [DEBUG] parsed items=${parsed.items} dated=${parsed.dated} window=${parsed.prices.length} query="${kw.slice(0, 70)}"`);
    }
    if (parsed.items >= 5 && parsed.dated === 0) { dateFail++; console.log(`  ⚠️ 落札日が取れない(items${parsed.items}/dated0)＝Sold日付のUI変更疑い : ${kw.slice(0, 40)}`); await jitterGap(); continue; }
    const stat = trimmedMedian(parsed.prices);
    if (!stat || stat.count < MIN_SAMPLE) { thin++; console.log(`  ・落札不足(窓内${stat?.count ?? 0}/items${parsed.items}/dated${parsed.dated}) : ${kw.slice(0, 40)}`); await jitterGap(); continue; }
    const medianJpy = Math.round(stat.median * USD_JPY);
    // 妥当性：現eBay相場(realAvgPrice JPY)から極端に乖離＝パース誤り疑い→破棄。
    const anchor = Number(p?.realAvgPrice) || 0;
    if (anchor > 0 && (medianJpy < anchor * SANE_LO || medianJpy > anchor * SANE_HI)) {
      implausible++; console.log(`  ⚠️ 妥当性NG ¥${medianJpy} vs 現相場¥${anchor}（破棄） : ${kw.slice(0, 40)}`); await jitterGap(); continue;
    }
    ok++;
    buffer.push({ key: `ebay_sold:${id}`, rec: { median: medianJpy, medianUsd: Math.round(stat.median * 100) / 100, count: stat.count, windowDays: WINDOW_DAYS, soldBased: true, at: new Date().toISOString() } });
    console.log(`  ✅ 直近${WINDOW_DAYS}日 ${stat.count}件 中央$${(stat.median).toFixed(2)}→¥${medianJpy} : ${kw.slice(0, 40)}`);
    await jitterGap();
  }

  // 系統的失敗ブレーキ：失敗率が高い＝UI変更/IPブロックの疑い→この実行は何も書かない（汚染回避）。
  const failRatio = done ? (blocked + implausible + dateFail) / done : 0; // thin(=直近30日の出来高が少ない)は正常な薄さなのでブレーキ対象外
  const healthy = !(done >= BRAKE_MIN && failRatio > BRAKE_RATIO);
  let wrote = 0;
  if (!healthy) {
    console.error(`🚨 異常率 ${(failRatio * 100).toFixed(0)}%（ブロック${blocked}/妥当性NG${implausible}/落札日不可${dateFail} of ${done}）＝eBay UI変更 or IPブロックの疑い。書込を全中止。要確認。`);
  } else if (!DRY) {
    for (const b of buffer) { if (await kvSetJson(b.key, b.rec, TTL_S)) wrote++; }
  }
  // 監視用サマリ（cron→メール通知に使える）。
  await kvSetJson("ebay_sold_status", { at: new Date().toISOString(), healthy, windowDays: WINDOW_DAYS, done, ok, wrote, blocked, thin, implausible, dateFail, failRatio: Math.round(failRatio * 100) }, 14 * 24 * 3600);
  console.log(`完了(直近${WINDOW_DAYS}日): 処理${done}/通過${ok}/書込${wrote}${DRY ? "(DRY)" : ""} ブロック${blocked} 落札不足${thin} 妥当性NG${implausible} 落札日不可${dateFail} 新鮮skip${skipped} healthy=${healthy}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
