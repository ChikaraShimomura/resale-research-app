#!/usr/bin/env node
// scripts/ebaySoldWorker.mjs
// 住宅IPワーカー：eBayの「売却済み(Sold/Completed)」検索ページをスクレイプして、カタログ各商品の
// 直近落札価格の中央値(JPY)を KV `ebay_sold:{productId}` に保存する。
// Marketplace Insights API(承認制)を待たずに“実落札”相場を取るための非公式手段(A案)。
//
// 【なぜ住宅IPでしか動かないか】
//   eBayの /sch ページは GitHub Actions 等のデータセンターIPから 403 で弾かれる（実測）。
//   住宅IP（このPC/Pixel+Termux）なら通る。楽天死活ワーカー(sourceLivenessWorker.mjs)と同じ理由・同じ運用。
//
// 【安全則】
//   ・DRY 既定ON：明示的に EBAY_SOLD_DRY=0 の時だけ KV へ書込む（未設定/その他は書かない）。
//   ・403/タイムアウト/サンプル<MIN は書かない（その商品はスキップ＝既存値を壊さない）。
//   ・礼儀：リクエスト間に GAP、同時実行は低め、1回の処理上限 MAX。
//   ・直近 FRESH_H 時間以内に取得済みの商品は再取得しない（負荷分散）。
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN（.env.local 自動読込）/ LANDED_USD_JPY（既定155）
//      EBAY_SOLD_DRY=0 で本番書込 / EBAY_SOLD_MAX / EBAY_SOLD_GAP_MS / EBAY_SOLD_TTL_H / EBAY_SOLD_FRESH_H

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
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const USD_JPY = Number(process.env.LANDED_USD_JPY) || 155;

const DRY = process.env.EBAY_SOLD_DRY !== "0";        // 既定: 書かない
const MAX = Number(process.env.EBAY_SOLD_MAX ?? 60);  // 1回の処理上限
const GAP_MS = Number(process.env.EBAY_SOLD_GAP_MS ?? 2500); // eBayへの礼儀（弾かれ防止）
const TTL_S = Number(process.env.EBAY_SOLD_TTL_H ?? 168) * 3600; // 保存TTL(既定7日)
const FRESH_S = Number(process.env.EBAY_SOLD_FRESH_H ?? 36) * 3600; // この時間内に取得済みは再取得しない
const MIN_SAMPLE = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H });
    const r = (await res.json()).result;
    if (r == null) return null;
    try { return JSON.parse(r); } catch { return r; }
  } catch { return null; }
}
async function kvSetJson(key, val, ttl) {
  // 値はJSON文字列で保存（@vercel/kv も raw REST も get時に JSON.parse する＝整合）。
  const url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(val))}?EX=${ttl}`;
  const res = await fetch(url, { method: "POST", headers: H });
  return res.ok;
}

// eBay 売却済みページから価格(USD)配列を抽出。.s-item__price（枯れたマークアップ）ベース。
function parseSoldUsd(html) {
  const prices = [];
  // 各 s-item__price の直後の最初の $金額を拾う（ネストspanに強い）。範囲表記は低い方を採用。
  const re = /s-item__price[^$]{0,40}\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0) prices.push(v);
  }
  // 先頭は「Shop on eBay」プレースホルダのことが多い＝1件目を捨てる（2件以上ある時のみ）。
  return prices.length > 1 ? prices.slice(1) : prices;
}

// 外れ値トリム＋中央値。
function trimmedMedian(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const cut = a.length >= 8 ? Math.floor(a.length * 0.1) : 0; // 上下10%トリム（8件以上時）
  const t = a.slice(cut, a.length - cut);
  const mid = Math.floor(t.length / 2);
  const med = t.length % 2 ? t[mid] : (t[mid - 1] + t[mid]) / 2;
  return { median: med, count: a.length };
}

async function fetchSold(keyword) {
  const q = encodeURIComponent(keyword.slice(0, 120));
  // Sold + Completed, 終了が新しい順(_sop=13), 1ページ60件, US。
  const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const html = await res.text();
    const usd = parseSoldUsd(html);
    return { ok: true, usd };
  } catch (e) {
    return { ok: false, status: "err:" + (e?.name || e?.message) };
  }
}

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定"); process.exit(1); }
  console.log(`eBay sold worker: DRY=${DRY} MAX=${MAX} GAP=${GAP_MS}ms USD_JPY=${USD_JPY}`);

  const catalog = (await kvGet("profitable_products")) || [];
  if (!Array.isArray(catalog) || catalog.length === 0) { console.log("カタログ空"); return; }

  const now = Math.floor(Date.now() / 1000);
  let done = 0, wrote = 0, blocked = 0, thin = 0, skipped = 0;
  for (const p of catalog) {
    if (done >= MAX) break;
    const id = p?.id;
    const kw = p?.coreKeyword || p?.title;
    if (!id || !kw) continue;

    // 直近取得済みはスキップ（負荷分散）。
    const prev = await kvGet(`ebay_sold:${id}`);
    if (prev && prev.at && now - Math.floor(new Date(prev.at).getTime() / 1000) < FRESH_S) { skipped++; continue; }

    done++;
    const r = await fetchSold(kw);
    if (!r.ok) { blocked++; console.log(`  ⛔ ${String(r.status)} : ${kw.slice(0, 40)}`); await sleep(GAP_MS); continue; }
    const stat = trimmedMedian(r.usd);
    if (!stat || stat.count < MIN_SAMPLE) { thin++; console.log(`  ・サンプル不足(${stat?.count ?? 0}) : ${kw.slice(0, 40)}`); await sleep(GAP_MS); continue; }

    const medianJpy = Math.round(stat.median * USD_JPY);
    const rec = { median: medianJpy, medianUsd: Math.round(stat.median * 100) / 100, count: stat.count, soldBased: true, at: new Date().toISOString() };
    console.log(`  ✅ ${stat.count}件 中央$${rec.medianUsd}→¥${medianJpy} : ${kw.slice(0, 40)}`);
    if (!DRY) { if (await kvSetJson(`ebay_sold:${id}`, rec, TTL_S)) wrote++; }
    await sleep(GAP_MS);
  }
  console.log(`完了: 処理${done} / 書込${wrote}${DRY ? "(DRY=書込なし)" : ""} / ブロック${blocked} / サンプル不足${thin} / 新鮮スキップ${skipped}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
