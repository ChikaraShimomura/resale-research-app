// シード済みデータでログイン画面(成績/出品中/発送)を本番から撮る。creds は env。
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
const shot = async (id) => { await page.screenshot({ path: path.join(RAW, `${id}.png`), type: "png" }); console.log("ok", id, "|", page.url()); };
const consent = async () => { for (const l of ["同意する", "同意", "OK"]) { try { await page.click(`text=${l}`, { timeout: 1000 }); break; } catch {} } };

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await consent();
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button[type="submit"]').catch(() => page.click("text=ログイン"));
await page.waitForTimeout(4500);

for (const [url, id] of [["/mypage", "a_mypage"], ["/listings", "a_listings"], ["/ship", "a_ship"]]) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(id);
}
await b.close();
console.log("done");
