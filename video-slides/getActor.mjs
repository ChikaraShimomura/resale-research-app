// テストアカウントの actor ID(acct:{supabase-uuid})を取得（シードの宛先）。creds は env。
import { chromium } from "playwright";
const BASE = "https://www.yushutsu-fukugyo.com";
const EMAIL = process.env.CAP_EMAIL, PASS = process.env.CAP_PASS;
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
for (const l of ["同意する", "同意", "OK"]) { try { await page.click(`text=${l}`, { timeout: 1000 }); break; } catch {} }
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASS);
await page.click('button[type="submit"]').catch(() => page.click("text=ログイン"));
await page.waitForTimeout(4500);
const cookies = await ctx.cookies();
// Supabase は大きいトークンを sb-...-auth-token(.0/.1) に分割する。名前順に連結。
const parts = cookies.filter((c) => /sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
let raw = parts.map((c) => c.value).join("");
try { raw = decodeURIComponent(raw); } catch {}
if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
let uuid = null;
try {
  const j = JSON.parse(raw);
  const at = j.access_token || (Array.isArray(j) ? j[0] : null);
  const payload = JSON.parse(Buffer.from(at.split(".")[1], "base64").toString("utf8"));
  uuid = payload.sub;
} catch (e) { console.log("decode error:", String(e), "| cookieNames:", parts.map((c) => c.name)); }
console.log("ACTOR=acct:" + uuid);
await b.close();
