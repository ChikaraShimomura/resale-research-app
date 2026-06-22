// ログインが要る画面(検索/商品詳細/マイページ等)を本番から撮る。認証情報は env(CAP_EMAIL/CAP_PASS)で渡す＝ファイルに残さない。
// 使い方: CAP_EMAIL=... CAP_PASS=... node video-slides/captureAuthed.mjs
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, "raw");
const BASE = "https://www.yushutsu-fukugyo.com";
const VIEWPORT = { width: 430, height: 860 };
const EMAIL = process.env.CAP_EMAIL, PASS = process.env.CAP_PASS;
if (!EMAIL || !PASS) { console.error("CAP_EMAIL/CAP_PASS 未設定"); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (id) => { await page.screenshot({ path: path.join(RAW, `${id}.png`), type: "png" }); console.log("ok", id); };
const consent = async () => { for (const l of ["同意する", "同意", "OK", "Accept"]) { try { await page.click(`text=${l}`, { timeout: 1000 }); break; } catch {} } };

// --- ログイン ---
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await consent();
try {
  await page.fill('input[type="email"]', EMAIL, { timeout: 5000 });
  await page.fill('input[type="password"]', PASS, { timeout: 5000 });
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.click('button[type="submit"]').catch(() => page.click("text=ログイン")),
  ]);
  await page.waitForTimeout(4000);
} catch (e) {
  console.log("login fill error:", String(e));
}
console.log("after login url:", page.url());

// --- 検索/一覧 ---
await page.goto(`${BASE}/search`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
console.log("search url:", page.url());
await shot("a_search");

// --- 商品詳細（検索結果の先頭商品へ） ---
const href = await page.getAttribute('a[href^="/product/"]', "href").catch(() => null);
console.log("first product href:", href);
if (href) {
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log("product url:", page.url());
  await shot("a_product");
}

// --- マイページ ---
await page.goto(`${BASE}/mypage`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
console.log("mypage url:", page.url());
await shot("a_mypage");

await browser.close();
console.log("done");
