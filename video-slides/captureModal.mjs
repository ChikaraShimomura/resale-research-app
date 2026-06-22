// eBay自動出品モーダル(EbayListingModal)の本物画面を撮る。eBay連携済みアカウントが前提。creds は env。
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, "raw");
const BASE = "https://www.yushutsu-fukugyo.com";
const EMAIL = process.env.CAP_EMAIL, PASS = process.env.CAP_PASS;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const consent = async () => { for (const l of ["同意する", "同意", "OK"]) { try { await page.click(`text=${l}`, { timeout: 1000 }); break; } catch {} } };

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await consent();
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button[type="submit"]').catch(() => page.click("text=ログイン"));
await page.waitForTimeout(4500);

await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
console.log("search url:", page.url());

// 「eBay自動出品」ボタン（ListingHelper）をクリック→モーダルが開く
await page.locator('text=eBay自動出品').first().click({ timeout: 8000 });
console.log("clicked 出品ボタン");

// モーダルの準備完了を待つ（公開ボタン or 価格欄が出るまで）。eBay APIで数秒かかる。
await page.waitForSelector('text=この内容でeBayに出品する', { timeout: 25000 }).catch(() => console.log("publish btn待ちtimeout(撮影は続行)"));
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(RAW, "a_modal_top.png"), type: "png" });
console.log("ok a_modal_top");

// 価格/損益分岐あたりまでスクロールした図も
await page.evaluate(() => { const m = document.querySelector('[class*="overflow-y"]') || document.scrollingElement; if (m) m.scrollTop = 360; window.scrollBy(0, 360); });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(RAW, "a_modal_price.png"), type: "png" });
console.log("ok a_modal_price");

await b.close();
console.log("done");
