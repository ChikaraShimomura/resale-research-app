#!/usr/bin/env node
// scripts/gemini_probe.mjs — Gemini画像判定が毎回 HTTP 400 になる原因を一発で特定する診断。
// 本番にも実験にも触れない。実画像(楽天1枚+eBay1枚)を取り、複数のリクエスト型を投げて
// それぞれの status と「エラー本文」を丸ごと出す。CIログで読む。

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const log = (...a) => console.error(...a);

async function ebayToken() {
  const enc = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${enc}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  const d = await res.json();
  return d.access_token;
}
async function ebayImg() {
  const tok = await ebayToken();
  const params = new URLSearchParams({ q: 'casio g-shock watch', filter: 'conditions:{NEW}', sort: 'price', limit: '5' });
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${tok}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  });
  const d = await res.json();
  for (const it of d.itemSummaries ?? []) {
    const u = it.image?.imageUrl ?? it.thumbnailImages?.[0]?.imageUrl;
    if (u) return u;
  }
  return null;
}
async function rakutenImg() {
  const params = new URLSearchParams({ applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY, affiliateId: RAKUTEN_AFFILIATE_ID, hits: '5', keyword: 'G-SHOCK 腕時計', format: 'json' });
  const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`, {
    headers: { Referer: 'https://www.yushutsu-fukugyo.com/', Origin: 'https://www.yushutsu-fukugyo.com' },
  });
  const d = await res.json();
  for (const x of d.Items ?? []) {
    const u = x.Item?.mediumImageUrls?.[0]?.imageUrl;
    if (u) return u.replace(/_ex=\d+x\d+/, '_ex=600x600');
  }
  return null;
}

async function grab(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { ok: r.ok, ct: r.headers.get('content-type'), bytes: buf.length, b64: buf.toString('base64') };
}

async function callGemini(label, body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  log(`\n### ${label} -> HTTP ${res.status}`);
  log(text.slice(0, 900));
}

(async () => {
  log('keys present:', { rakuten: !!RAKUTEN_APP_ID, ebay: !!EBAY_APP_ID, gemini: !!GEMINI_API_KEY });
  const [eUrl, rUrl] = await Promise.all([ebayImg(), rakutenImg()]);
  log('eBay img:', eUrl);
  log('Rakuten img:', rUrl);
  const [E, R] = await Promise.all([grab(eUrl), grab(rUrl)]);
  log('eBay fetched:', { ok: E.ok, ct: E.ct, bytes: E.bytes });
  log('Rakuten fetched:', { ok: R.ok, ct: R.ct, bytes: R.bytes });

  const prompt = 'Do these two photos show the EXACT SAME product variant? Answer YES or NO only.';

  // H1: 実験と同一 (camelCase, mimeType=生content-type, maxOutputTokens 4)
  await callGemini('H1 experiment-exact (camelCase, raw ct, maxTok=4)', {
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: R.ct ?? 'image/jpeg', data: R.b64 } },
      { inlineData: { mimeType: E.ct ?? 'image/jpeg', data: E.b64 } },
    ]}], generationConfig: { maxOutputTokens: 4, temperature: 0 },
  });

  // H2: 本番と同一 (camelCase, maxOutputTokens 200)
  await callGemini('H2 production-like (camelCase, raw ct, maxTok=200)', {
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: R.ct ?? 'image/jpeg', data: R.b64 } },
      { inlineData: { mimeType: E.ct ?? 'image/jpeg', data: E.b64 } },
    ]}], generationConfig: { maxOutputTokens: 200, temperature: 0 },
  });

  // H3: mimeType を image/jpeg に強制 (content-type が原因か切り分け)
  await callGemini('H3 forced mimeType=image/jpeg, maxTok=200', {
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: R.b64 } },
      { inlineData: { mimeType: 'image/jpeg', data: E.b64 } },
    ]}], generationConfig: { maxOutputTokens: 200, temperature: 0 },
  });

  // H4: snake_case (inline_data / mime_type)
  await callGemini('H4 snake_case inline_data/mime_type, maxTok=200', {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: R.ct ?? 'image/jpeg', data: R.b64 } },
      { inline_data: { mime_type: E.ct ?? 'image/jpeg', data: E.b64 } },
    ]}], generationConfig: { maxOutputTokens: 200, temperature: 0 },
  });

  // H5: テキストのみ (画像抜き) — 鍵/モデル自体が生きているかの基準線
  await callGemini('H5 text-only baseline', {
    contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: { maxOutputTokens: 5, temperature: 0 },
  });

  log('\nPROBE_DONE');
})().catch((e) => { log('FATAL', e.message); process.exit(1); });
