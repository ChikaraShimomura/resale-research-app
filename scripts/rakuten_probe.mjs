#!/usr/bin/env node
// scripts/rakuten_probe.mjs — 楽天Ichiba Item Search APIが「正確な送料額」と「商品固有ポイント倍率」を
// 返すかを実データで確定する診断。本番に触れない。CIログで読む。

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const log = (...a) => console.error(...a);

async function search(keyword) {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY, affiliateId: RAKUTEN_AFFILIATE_ID,
    hits: '10', page: '1', sort: '-reviewCount', format: 'json', minPrice: '1000', maxPrice: '100000', keyword,
  });
  const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`, {
    headers: { Referer: 'https://www.yushutsu-fukugyo.com/', Origin: 'https://www.yushutsu-fukugyo.com' },
  });
  if (!res.ok) { log(`HTTP ${res.status} for "${keyword}"`); return []; }
  const d = await res.json();
  return (d.Items ?? []).map((x) => x.Item).filter(Boolean);
}

(async () => {
  const items = await search('figma 新品');
  if (!items.length) { log('no items'); return; }
  // 1件目の全キーを出す（shipping/postage/point 系フィールドの有無を確認）
  log('=== item[0] ALL KEYS ===');
  log(Object.keys(items[0]).sort().join(', '));
  // 送料/ポイント関連フィールドだけ抽出して複数件
  log('\n=== shipping/point fields per item ===');
  const all = [...items, ...(await search('ポケモンカード BOX')), ...(await search('資生堂 化粧水'))];
  for (const it of all.slice(0, 18)) {
    const ship = {};
    for (const k of Object.keys(it)) if (/postage|ship|送料|delivery/i.test(k)) ship[k] = it[k];
    log(`pointRate=${it.pointRate} (start=${it.pointRateStartTime || '-'} end=${it.pointRateEndTime || '-'}) | postageFlag=${it.postageFlag} | ${JSON.stringify(ship)} | ¥${it.itemPrice} | ${(it.itemName || '').slice(0, 28)}`);
  }
  // pointRateの分布
  const rates = all.map((it) => it.pointRate).filter((v) => v != null);
  const dist = {};
  for (const r of rates) dist[r] = (dist[r] || 0) + 1;
  log('\n=== pointRate distribution ===', JSON.stringify(dist));
  log('\nPROBE_DONE');
})().catch((e) => { log('FATAL', e.message); process.exit(1); });
