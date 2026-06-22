// ホーム紹介動画(home)用の「実際の画面」スクショ。公開ページ(本番)から撮る＝本物データ。
// 出力: raw/h_*.png（produce.mjs が composer のカードに載せる）。
// 認証/eBay連携が要る画面(出品モーダル・マイページ・売却検知)はローカルから本物が撮れないため対象外。
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, "raw");
const BASE = "https://www.yushutsu-fukugyo.com";
const VIEWPORT = { width: 430, height: 860 };

async function shot(page, id) {
  await page.screenshot({ path: path.join(RAW, `${id}.png`), type: "png" });
  console.log(`ok ${id}.png`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// Cookie同意バナーを消す（最初に一度）。同一コンテキストなら以降のページでも非表示。
await page.goto(`${BASE}/ranking`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
for (const label of ["同意する", "同意", "OK", "Accept"]) {
  try { await page.click(`text=${label}`, { timeout: 1200 }); break; } catch {}
}
await page.waitForTimeout(400);

// 1) ランキング上部（見出し＋上位＝価値が一目で）
await shot(page, "h_ranking_top");

// 2) ランキングを少しスクロール＝モザイクでない実在商品(楽天→eBay→利益率)が見える位置
await page.evaluate(() => window.scrollBy(0, 620));
await page.waitForTimeout(500);
await shot(page, "h_ranking_items");

// 3) ホーム上部（ブランド/ヒーロー）
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot(page, "h_home_top");

// 4) 料金プラン
await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot(page, "h_pricing");

await browser.close();
console.log("done");
