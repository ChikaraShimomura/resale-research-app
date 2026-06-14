import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, 'raw');
const BASE = 'http://localhost:3001';

async function shot(page, headingText, cardSelector, outId) {
  const handle = await page.evaluateHandle(
    ({ headingText, cardSelector }) => {
      const all = [...document.querySelectorAll('h1,h2,h3')];
      const h = all.find((e) => e.textContent.includes(headingText));
      return h ? h.closest(cardSelector) : null;
    },
    { headingText, cardSelector }
  );
  const el = handle.asElement();
  if (!el) { console.log(`x MISS ${outId} (${headingText})`); return; }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(150);
  await el.screenshot({ path: path.join(RAW, `${outId}.png`), type: 'png' });
  console.log(`ok ${outId}.png`);
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
// 同意バナーを出さない（カード下部がかぶるのを防ぐ）
await page.addInitScript(() => { try { localStorage.setItem('cookie_consent_v1', 'denied'); } catch {} });

// 1. はじめてガイド: step3/4/5（警告ボックス入り）
await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
await shot(page, 'eBayに出品する', 'div.bg-white.rounded-2xl', 'g_step3');
await shot(page, '売れたら発送する', 'div.bg-white.rounded-2xl', 'g_step4');
await shot(page, '利益を受け取る', 'div.bg-white.rounded-2xl', 'g_step5');

// 2. Payoneer出金: intro(お金の流れ) / STEP4(USD・円) / つまずき(5項目)
await page.goto(`${BASE}/guide/payoneer-withdraw`, { waitUntil: 'networkidle' });
await shot(page, 'eBayの売上 → あなたの銀行口座へ', 'div.bg-white.rounded-2xl', 'p_intro');
await shot(page, '出金する金額を入力する', 'section', 'p_step4');
await shot(page, 'よくあるつまずき', 'div.bg-white.rounded-2xl', 'p_troubles');

// 3. eBay登録: よくあるつまずき(6項目)
await page.goto(`${BASE}/guide/ebay-seller`, { waitUntil: 'networkidle' });
await shot(page, 'よくあるつまずき', 'div.bg-white.rounded-2xl', 'e_troubles');

await b.close();
console.log('done');
