#!/usr/bin/env node
// scripts/restore_product.mjs — 楽天URL(またはitemCode)を1点、利益商品カタログ＋出品アーカイブ(psnap)へ復活させる。
// リフレッシュでカタログから入れ替わって落ちた商品を、運営が手動で戻すための管理ツール。
// 楽天商品を取得→eBay最安価格→利益計算→profitable_products に追加(重複は更新)＋psnap:{id} に2年保存。
// 環境変数: RAKUTEN_APP_ID/RAKUTEN_ACCESS_KEY/RAKUTEN_AFFILIATE_ID, EBAY_APP_ID/EBAY_CLIENT_SECRET,
//          KV_REST_API_URL/KV_REST_API_TOKEN, RESTORE_URL(必須), RESTORE_KEYWORD(任意=eBay検索語/英語)。

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const RESTORE_URL = process.env.RESTORE_URL || "";
const RESTORE_KEYWORD = (process.env.RESTORE_KEYWORD || "").trim();

const USD_TO_JPY = 155;
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED_JPY = 47;
const SHIPPING_COST_JPY = 0;
const DOMESTIC_SHIP_JPY = {
  'トレカ': 350, 'コスメ': 500, 'ゲーム': 400, 'フィギュア': 800, 'ガンプラ': 800,
  'LEGO': 1000, '腕時計': 600, 'ゲーム機': 1100, 'カメラ': 1000, 'おもちゃ': 700, 'その他': 700,
};

function guessCategory(title) {
  const t = title || '';
  if (/コスメ|香水|スキンケア|資生堂|花王|専科|化粧水|乳液|美容液|洗顔|クレンジング|日焼け止め|キャンメイク|CANMAKE|SK-?II|肌ラボ|チーク|ファンデ|化粧下地/i.test(t)) return 'コスメ';
  if (/ポケモン|遊戯王|デュエルマスターズ|トレカ|カードゲーム|ワンピースカード/i.test(t)) return 'トレカ';
  if (/ガンプラ|ガンダム|\bMG\b|\bHG\b|\bRG\b|\bPG\b|1\/100|1\/144|BANDAI SPIRITS|30MM/i.test(t)) return 'ガンプラ';
  if (/LEGO|レゴ/i.test(t)) return 'LEGO';
  if (/フィギュア|ねんどろいど|Nendoroid|figma|グッドスマイル|GOOD SMILE|S\.?H\.?\s?Figuarts|フィギュアーツ|超合金/i.test(t)) return 'フィギュア';
  if (/Nintendo Switch|PS5|PlayStation|Xbox/i.test(t)) return 'ゲーム機';
  if (/amiibo|アミーボ|ゲームソフト/i.test(t)) return 'ゲーム';
  if (/腕時計|Watch|Seiko|セイコー|Citizen|シチズン|Casio|カシオ|Gショック|G-SHOCK/i.test(t)) return '腕時計';
  if (/カメラ|レンズ|Canon|Nikon|Fujifilm|一眼レフ/i.test(t)) return 'カメラ';
  if (/トミカ|プラレール|シルバニア|ベイブレード|BEYBLADE/i.test(t)) return 'おもちゃ';
  return 'その他';
}

function domesticShipping(category, postageFlag, title) {
  if (/送料無料|送料込/.test(title || '')) return 0;
  if (Number(postageFlag) === 0) return 0;
  return DOMESTIC_SHIP_JPY[category] ?? 700;
}

function calcProfit(rakutenPrice, ebayAvgJpy, pointAmount, domesticShipJpy = 0) {
  const effectiveBuy = rakutenPrice + domesticShipJpy - pointAmount;
  if (effectiveBuy <= 0) return { profit: 0, profitRate: 0 };
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuy - ebayFee - SHIPPING_COST_JPY;
  return { profit, profitRate: Math.round((profit / effectiveBuy) * 100) };
}

// URL or "shop:itemcode" から楽天itemCodeを取り出す。例: http://item.rakuten.co.jp/moon-f/dal7bp/ → moon-f:dal7bp
function parseItemCode(input) {
  const s = (input || "").trim();
  const m = s.match(/item\.rakuten\.co\.jp\/([^/]+)\/([^/?#]+)/i);
  if (m) return `${m[1]}:${decodeURIComponent(m[2])}`;
  if (/^[^:\s]+:[^:\s]+$/.test(s)) return s; // 既に shop:itemcode 形式
  return null;
}

async function fetchRakutenByItemCode(itemCode) {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    itemCode,
    format: 'json',
  });
  const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`, {
    headers: { Referer: 'https://www.yushutsu-fukugyo.com/', Origin: 'https://www.yushutsu-fukugyo.com', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Rakuten HTTP ${res.status}`);
  const items = (await res.json()).Items ?? [];
  return items[0]?.Item ?? items[0] ?? null;
}

let ebayTok = null;
async function getEbayToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayTok && Date.now() < ebayTok.exp) return ebayTok.t;
  const enc = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${enc}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const d = await res.json();
  ebayTok = { t: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return d.access_token;
}

// 同等品の現行eBay最安(USD→JPY)。新品/ほぼ新品の最安を採用（出品時に prepare が再計算するので概算で十分）。
async function ebayLowestJpy(keyword) {
  const t = await getEbayToken();
  if (!t) return 0;
  const params = new URLSearchParams({ q: (keyword || '').slice(0, 120), filter: 'conditions:{NEW|LIKE_NEW}', sort: 'price', limit: '10' });
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${t}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return 0;
  const d = await res.json();
  for (const it of d.itemSummaries ?? []) {
    const v = parseFloat(it.price?.value);
    if (it.price?.currency === 'USD' && v > 0) return Math.round(v * USD_TO_JPY);
  }
  return 0;
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}
async function kvPipeline(cmds) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`KV pipeline HTTP ${res.status}`);
}

(async () => {
  const itemCode = parseItemCode(RESTORE_URL);
  if (!itemCode) { console.error('RESTORE_URL から楽天itemCodeを取得できません:', RESTORE_URL); process.exit(1); }
  console.log('復活対象 itemCode:', itemCode);

  const it = await fetchRakutenByItemCode(itemCode);
  if (!it || !it.itemPrice) { console.error('楽天商品が取得できませんでした（販売終了/itemCode誤り）:', itemCode); process.exit(1); }

  const title = it.itemName;
  const category = guessCategory(title);
  const rakutenImg = it.mediumImageUrls?.[0]?.imageUrl?.replace(/\?_ex=\d+x\d+$/, '') || it.smallImageUrls?.[0]?.imageUrl || '';
  const pointRate = it.pointRate ?? 1;
  const pointAmount = Math.round(it.itemPrice * (pointRate / 100));
  const shipJpy = domesticShipping(category, it.postageFlag, title);

  // eBay検索語：明示の RESTORE_KEYWORD を優先（無ければタイトル内のASCII語＝型番/ブランドを抽出）。
  let coreKeyword = RESTORE_KEYWORD;
  if (!coreKeyword) {
    const ascii = (title.match(/[A-Za-z][A-Za-z0-9-]{1,}/g) || []).slice(0, 6).join(' ');
    coreKeyword = ascii || title;
  }
  console.log('eBay検索語(coreKeyword):', coreKeyword);

  const ebayJpy = await ebayLowestJpy(coreKeyword);
  if (!ebayJpy) console.warn('  ⚠️ eBay最安が取得できませんでした。realAvgPrice=0 で登録（出品時に prepare が再計算します）。');
  const { profit, profitRate } = calcProfit(it.itemPrice, ebayJpy, pointAmount, shipJpy);
  console.log(`  楽天¥${it.itemPrice} / eBay¥${ebayJpy} / 国内送料¥${shipJpy} / ポイント¥${pointAmount} → 利益¥${profit}(${profitRate}%)`);

  const product = {
    id: it.itemCode,
    title,
    imageUrl: rakutenImg,
    images: (it.mediumImageUrls ?? []).map(x => (x?.imageUrl || '').replace(/\?_ex=\d+x\d+$/, '')).filter(Boolean),
    category,
    source: {
      site: 'rakuten', siteName: '楽天', price: it.itemPrice,
      url: it.affiliateUrl || it.itemUrl,
      pointRate, pointAmount, shippingJpy: shipJpy,
      postageIncluded: Number(it.postageFlag) === 0,
    },
    isNew: title.includes('新品') || title.includes('未開封'),
    market: 'EBAY_US',
    coreKeyword,
    ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(coreKeyword)}&LH_Complete=1&LH_Sold=1`,
    realAvgPrice: ebayJpy,
    realMedianPrice: ebayJpy,
    realProfit: profit,
    realProfitRate: profitRate,
    realCount: 1,
    avgDaysToSell: null,
    addedAt: new Date().toISOString(),
    matchedEbayImageUrl: '',
    matchedEbayUrl: coreKeyword ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(coreKeyword)}` : '',
    matchedEbayTitle: '',
    restored: true, // 手動復活フラグ（監査・識別用）
  };

  // カタログへ追加（既存は更新）。新着が先頭に来るよう addedAt 降順で並べ直す。
  const current = (await kvGet('profitable_products')) || [];
  const arr = Array.isArray(current) ? current : [];
  const filtered = arr.filter(p => p && p.id !== product.id);
  filtered.unshift(product);
  filtered.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  await kvPipeline([['SET', 'profitable_products', JSON.stringify(filtered), 'EX', String(480 * 3600)]]);
  await kvPipeline([['SET', `psnap:${product.id}`, JSON.stringify(product), 'EX', String(730 * 24 * 3600)]]);

  console.log(`✅ 復活完了: ${product.id} をカタログ(${filtered.length}件)＋出品アーカイブ(psnap)へ追加しました。`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
