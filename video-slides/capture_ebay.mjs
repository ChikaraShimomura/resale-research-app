import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(__dirname, 'raw');
const BASE = 'http://localhost:3001';

const stepPhones = {
  0: ['e_s1_login', 'e_s1_sell', 'e_s1_search', 'e_s1_getstarted'],
  1: ['e_s2_signup', 'e_s2_type', 'e_s2_contact', 'e_s2_kyc', 'e_s2_bank', 'e_s2_done'],
  2: ['e_s3_sync', 'e_s3_card', 'e_s3_submit'],
  3: ['e_s4_listing'],
};

const b = await chromium.launch();
for (const step of [0, 1, 2, 3]) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((s) => { try { localStorage.setItem('ebay_guide_step', String(s)); } catch {} }, step);
  await page.goto(`${BASE}/guide/ebay-seller`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const phones = await page.$$('div[class*="max-w-[260px]"]');
  const ids = stepPhones[step];
  console.log(`step ${step}: found ${phones.length} phones, expect ${ids.length}`);
  for (let i = 0; i < ids.length; i++) {
    if (!phones[i]) { console.log(`  x MISSING ${ids[i]}`); continue; }
    await phones[i].scrollIntoViewIfNeeded().catch(() => {});
    await phones[i].screenshot({ path: path.join(RAW, `${ids[i]}.png`), type: 'png' });
    console.log(`  ok ${ids[i]}.png`);
  }
  await ctx.close();
}
await b.close();
