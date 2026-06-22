#!/usr/bin/env node
// scripts/ebaySoldWorker.mjs
// eBayの「売却済み(Sold/Completed)」ページをスクレイプし、カタログ各商品の直近落札中央値(JPY)を
// KV `ebay_sold:{productId}` に保存する。Marketplace Insights API(承認制)を待たない回避策A。
//
// 【Pixel/Termuxで動く】Chromium不要の純node fetch。ただし“ブラウザ並み”に振る舞う：
//   実Chromeのヘッダ一式(sec-ch-ua等)＋トップで Cookie を温める＋Referer＋商品間の間隔をランダム化。
//   eBayの403は主にIP起因＝住宅IP(Pixel/このPC)なら通る見込み。DC IP(GitHub Actions等)は不可。
//   ※楽天死活ワーカー(sourceLivenessWorker.mjs)と同じTermux運用に乗せられる。
//   ※もし住宅IPでも弾かれる時は EBAY_SOLD_BROWSER=1 で実ブラウザ版(別途)に切替（PC専用）。
//
// 使い方(PowerShell/Termux・リポジトリ直下):
//   EBAY_SOLD_DRY=1 EBAY_SOLD_MAX=5 node scripts/ebaySoldWorker.mjs   # 試運転(書込なし)
//   EBAY_SOLD_DRY=0 node scripts/ebaySoldWorker.mjs                    # 本書込
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN(.env.local自動) / LANDED_USD_JPY(既定155)
//      EBAY_SOLD_DRY=0で本書込 / EBAY_SOLD_MAX / EBAY_SOLD_GAP_MS / EBAY_SOLD_TTL_H / EBAY_SOLD_FRESH_H

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
const GAP_MS = Number(process.env.EBAY_SOLD_GAP_MS ?? 4000); // 基準。実際は×1〜2.2でゆらぐ
const TTL_S = Number(process.env.EBAY_SOLD_TTL_H ?? 168) * 3600;
const FRESH_S = Number(process.env.EBAY_SOLD_FRESH_H ?? 36) * 3600;
const MIN_SAMPLE = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const jitterGap = () => sleep(Math.round(GAP_MS * rnd(1, 2.2)));

// ===== ブラウザ並みのヘッダ＋Cookieジャー（人間っぽさ＝弾かれ回避） =====
const cookieJar = {};
function cookieHeader() {
  const s = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
  return s || undefined;
}
function storeCookies(res) {
  try {
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) cookieJar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  } catch {}
}
function browserHeaders(referer) {
  const h = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) h.Referer = referer;
  const c = cookieHeader(); if (c) h.Cookie = c;
  return h;
}

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H });
    const r = (await res.json()).result;
    if (r == null) return null;
    try { return JSON.parse(r); } catch { return r; }
  } catch { return null; }
}
async function kvSetJson(key, val, ttl) {
  const url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(val))}?EX=${ttl}`;
  const res = await fetch(url, { method: "POST", headers: H });
  return res.ok;
}

function parseSoldUsd(html) {
  const prices = [];
  const re = /s-item__price[^$]{0,40}\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0) prices.push(v);
  }
  return prices.length > 1 ? prices.slice(1) : prices; // 先頭=プレースホルダを捨てる
}
function trimmedMedian(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const cut = a.length >= 8 ? Math.floor(a.length * 0.1) : 0;
  const t = a.slice(cut, a.length - cut);
  const mid = Math.floor(t.length / 2);
  return { median: t.length % 2 ? t[mid] : (t[mid - 1] + t[mid]) / 2, count: a.length };
}

async function get(url, referer) {
  const res = await fetch(url, { headers: browserHeaders(referer), redirect: "follow", signal: AbortSignal.timeout(20000) });
  storeCookies(res);
  const html = await res.text();
  return { status: res.status, html };
}
function isBlocked(html) {
  return /Pardon Our Interruption|Checking your browser|verify you are a human|to continue, please|captcha/i.test(html.slice(0, 4000));
}

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定"); process.exit(1); }
  console.log(`eBay sold worker (fetch): DRY=${DRY} MAX=${MAX} GAP=${GAP_MS}ms USD_JPY=${USD_JPY}`);
  const catalog = (await kvGet("profitable_products")) || [];
  if (!Array.isArray(catalog) || catalog.length === 0) { console.log("カタログ空"); return; }

  // ウォームアップ：トップで Cookie を温める（いきなり検索しない＝人間的）。
  try { const w = await get("https://www.ebay.com", null); if (isBlocked(w.html)) console.log("  ⚠️ トップで検問。住宅IPでないかも"); await sleep(Math.round(rnd(1200, 2500))); } catch {}

  const now = Math.floor(Date.now() / 1000);
  let done = 0, wrote = 0, blocked = 0, thin = 0, skipped = 0;
  for (const p of catalog) {
    if (done >= MAX) break;
    const id = p?.id, kw = p?.coreKeyword || p?.title;
    if (!id || !kw) continue;
    const prev = await kvGet(`ebay_sold:${id}`);
    if (prev?.at && now - Math.floor(new Date(prev.at).getTime() / 1000) < FRESH_S) { skipped++; continue; }

    done++;
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(kw.slice(0, 120))}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
    let r;
    try { r = await get(url, "https://www.ebay.com/"); } catch (e) { r = { status: "err:" + (e?.name || e?.message), html: "" }; }
    if (typeof r.status !== "number" || r.status >= 400) { blocked++; console.log(`  ⛔ ${r.status} : ${kw.slice(0, 40)}`); await sleep(Math.round(rnd(15000, 30000))); continue; }
    if (isBlocked(r.html)) { blocked++; console.log(`  ⛔ 検問ページ : ${kw.slice(0, 40)}（バックオフ）`); await sleep(Math.round(rnd(30000, 60000))); continue; }

    const stat = trimmedMedian(parseSoldUsd(r.html));
    if (!stat || stat.count < MIN_SAMPLE) { thin++; console.log(`  ・サンプル不足(${stat?.count ?? 0}) : ${kw.slice(0, 40)}`); await jitterGap(); continue; }
    const medianJpy = Math.round(stat.median * USD_JPY);
    const rec = { median: medianJpy, medianUsd: Math.round(stat.median * 100) / 100, count: stat.count, soldBased: true, at: new Date().toISOString() };
    console.log(`  ✅ ${stat.count}件 中央$${rec.medianUsd}→¥${medianJpy} : ${kw.slice(0, 40)}`);
    if (!DRY) { if (await kvSetJson(`ebay_sold:${id}`, rec, TTL_S)) wrote++; }
    await jitterGap();
  }
  console.log(`完了: 処理${done} / 書込${wrote}${DRY ? "(DRY)" : ""} / ブロック${blocked} / サンプル不足${thin} / 新鮮スキップ${skipped}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
