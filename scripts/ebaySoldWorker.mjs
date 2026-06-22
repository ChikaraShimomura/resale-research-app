#!/usr/bin/env node
// scripts/ebaySoldWorker.mjs
// eBayの「売却済み(Sold/Completed)」ページを実ブラウザ(Playwright/Chromium)で“人が見てる”ように開いて、
// カタログ各商品の直近落札中央値(JPY)を KV `ebay_sold:{productId}` に保存する。
// Marketplace Insights API(承認制)を待たずに実落札相場を取る回避策A。
//
// 【人間っぽい挙動】素のfetchはボット判定で弾かれる(403)。実Chromium＋本物の指紋/Cookie/言語、
//   トップページから入る、スクロール、リクエスト間隔ランダム化、ブロック検知でバックオフ。
// 【実行環境】Chromiumが要る＝住宅IPのPCで実行（DC IPは403／Termuxはchromium不可）。
//   楽天死活ワーカー(sourceLivenessWorker.mjs)はTermux継続、eBay落札はこのPC担当。
//
// 使い方(PowerShell・リポジトリ直下):
//   $env:EBAY_SOLD_DRY=1; $env:EBAY_SOLD_MAX=5; node scripts/ebaySoldWorker.mjs   # 試運転(書込なし)
//   $env:EBAY_SOLD_DRY=0; node scripts/ebaySoldWorker.mjs                          # 本書込
//   $env:EBAY_SOLD_HEADFUL=1 ...  # ブラウザ画面を表示して回す(より人間的・目視確認用)
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN(.env.local自動) / LANDED_USD_JPY(既定155)
//      EBAY_SOLD_DRY=0で本書込 / EBAY_SOLD_MAX / EBAY_SOLD_GAP_MS / EBAY_SOLD_TTL_H / EBAY_SOLD_FRESH_H / EBAY_SOLD_HEADFUL

import fs from "node:fs";
import { chromium } from "playwright";

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
const GAP_MS = Number(process.env.EBAY_SOLD_GAP_MS ?? 4000); // 基準間隔（実際は ×1〜2 でゆらぐ）
const TTL_S = Number(process.env.EBAY_SOLD_TTL_H ?? 168) * 3600;
const FRESH_S = Number(process.env.EBAY_SOLD_FRESH_H ?? 36) * 3600;
const HEADFUL = process.env.EBAY_SOLD_HEADFUL === "1";
const MIN_SAMPLE = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);       // 人間っぽいゆらぎ
const jitterGap = () => sleep(Math.round(GAP_MS * rnd(1, 2.2))); // 商品間：4〜8.8秒で不規則

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

function trimmedMedian(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const cut = a.length >= 8 ? Math.floor(a.length * 0.1) : 0;
  const t = a.slice(cut, a.length - cut);
  const mid = Math.floor(t.length / 2);
  const med = t.length % 2 ? t[mid] : (t[mid - 1] + t[mid]) / 2;
  return { median: med, count: a.length };
}

// 人間っぽいスクロール（数回・不規則）。lazy-load を促し挙動を自然に。
async function humanScroll(page) {
  const steps = Math.round(rnd(2, 4));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, Math.round(rnd(500, 1100)));
    await sleep(Math.round(rnd(350, 900)));
  }
}

// 1商品ぶん：検索ページを開き、価格(USD)配列を返す。block時は {blocked:true}。
async function scrapeSold(page, keyword) {
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword.slice(0, 120))}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // ボット検問ページの検知
  const body = (await page.title()) + " " + (await page.evaluate(() => document.body?.innerText?.slice(0, 400) || ""));
  if (/Pardon Our Interruption|Checking your browser|verify you are a human|robot|captcha/i.test(body)) return { blocked: true };
  await page.waitForSelector(".s-item__price", { timeout: 12000 }).catch(() => {});
  await humanScroll(page);
  const texts = await page.$$eval(".s-item__price", (els) => els.map((e) => e.textContent || ""));
  // "$24.99" / "$10.00 to $20.00" → 数値(範囲は低い方)
  let usd = texts.map((t) => {
    const m = t.replace(/,/g, "").match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
    return m ? parseFloat(m[1]) : 0;
  }).filter((v) => v > 0);
  if (usd.length > 1) usd = usd.slice(1); // 先頭=「Shop on eBay」プレースホルダを捨てる
  return { usd };
}

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定"); process.exit(1); }
  console.log(`eBay sold worker (browser): DRY=${DRY} MAX=${MAX} GAP=${GAP_MS}ms headful=${HEADFUL} USD_JPY=${USD_JPY}`);
  const catalog = (await kvGet("profitable_products")) || [];
  if (!Array.isArray(catalog) || catalog.length === 0) { console.log("カタログ空"); return; }

  const browser = await chromium.launch({ headless: !HEADFUL, args: ["--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  const page = await ctx.newPage();

  // ウォームアップ：まずトップへ寄って Cookie を温める（いきなり検索しない＝人間的）。
  try {
    await page.goto("https://www.ebay.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    for (const l of ["Accept all", "Accept All", "同意"]) { try { await page.click(`text=${l}`, { timeout: 1500 }); break; } catch {} }
    await sleep(Math.round(rnd(1200, 2500)));
  } catch {}

  const now = Math.floor(Date.now() / 1000);
  let done = 0, wrote = 0, blocked = 0, thin = 0, skipped = 0;
  for (const p of catalog) {
    if (done >= MAX) break;
    const id = p?.id, kw = p?.coreKeyword || p?.title;
    if (!id || !kw) continue;
    const prev = await kvGet(`ebay_sold:${id}`);
    if (prev?.at && now - Math.floor(new Date(prev.at).getTime() / 1000) < FRESH_S) { skipped++; continue; }

    done++;
    let r;
    try { r = await scrapeSold(page, kw); } catch (e) { r = { blocked: false, err: e?.message }; }
    if (r?.blocked) {
      blocked++; console.log(`  ⛔ ブロック検問: ${kw.slice(0, 40)}（長めにバックオフ）`);
      await sleep(Math.round(rnd(30000, 60000))); continue; // 検問が出たら大きく待つ
    }
    const stat = r?.usd ? trimmedMedian(r.usd) : null;
    if (!stat || stat.count < MIN_SAMPLE) { thin++; console.log(`  ・サンプル不足(${stat?.count ?? 0}) : ${kw.slice(0, 40)}`); await jitterGap(); continue; }
    const medianJpy = Math.round(stat.median * USD_JPY);
    const rec = { median: medianJpy, medianUsd: Math.round(stat.median * 100) / 100, count: stat.count, soldBased: true, at: new Date().toISOString() };
    console.log(`  ✅ ${stat.count}件 中央$${rec.medianUsd}→¥${medianJpy} : ${kw.slice(0, 40)}`);
    if (!DRY) { if (await kvSetJson(`ebay_sold:${id}`, rec, TTL_S)) wrote++; }
    await jitterGap();
  }
  await browser.close();
  console.log(`完了: 処理${done} / 書込${wrote}${DRY ? "(DRY)" : ""} / ブロック${blocked} / サンプル不足${thin} / 新鮮スキップ${skipped}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
