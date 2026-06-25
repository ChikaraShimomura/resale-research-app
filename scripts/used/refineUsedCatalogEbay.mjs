#!/usr/bin/env node
// scripts/used/refineUsedCatalogEbay.mjs
// 【型番単位リファイナ＋根拠リンク】used_catalog の各商品を「ブランド+型番(code)」でeBay落札(Sold/Completed)検索し、
// その機種の落札中央値を取得→ ebayMedianJpy を系列中央値から「型番単位の実落札」に置き換える。
// さらに、その商品が依拠する eBay落札検索URL(=根拠ボタンのリンク先) を ebaySoldUrl に保存（表示の数値と根拠が一致）。
// 落札パーサ/取得は ebaySoldWorker.mjs のSSOTを再利用。住宅IP・低頻度（warmup1回＋間隔＋ジッタ）。
// 使い方: node scripts/used/refineUsedCatalogEbay.mjs [limit]   （limit省略=全件）
import fs from "node:fs";
import { get, parseSoldWithin } from "../ebaySoldWorker.mjs";

const USD_JPY = 155;
const WINDOW_DAYS = 90; // 中古は出来高が薄いので落札窓は広め
const GAP_MS = Number(process.env.EBAY_GAP_MS) || 8000;
const LIMIT = Number(process.argv[2]) || Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(Math.round(GAP_MS * (1 + Math.random())));

function envv(k) {
  const e = fs.readFileSync(".env.local", "utf8");
  const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}
const KV_URL = envv("KV_REST_API_URL") || envv("UPSTASH_REDIS_REST_URL");
const KV_TOK = envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN");

function netProfitJPY(buyJpy, sellJpy) {
  const fee = sellJpy * 0.1325 + 47;
  const shipFee = 2040 * 0.1325;
  const dutyJpy = sellJpy / USD_JPY > 100 ? sellJpy * 0.1 + 230 : 0;
  return Math.round(sellJpy - fee - shipFee - dutyJpy - buyJpy);
}
// 外れ値を除いた中央値（少数サンプルの跳ねを抑える）。
function trimmedMedian(prices) {
  const ps = prices.slice().sort((a, b) => a - b);
  const raw = ps[Math.floor(ps.length / 2)];
  const kept = ps.filter((v) => v >= raw * 0.4 && v <= raw * 2.5);
  const k = kept.length ? kept : ps;
  return k[Math.floor(k.length / 2)];
}
// eBay落札検索URL（=根拠ボタンのリンク先）。ブランド+型番が最強、無ければブランド+商品名。
function soldQuery(p) {
  return ([p.brand, p.code].filter(Boolean).join(" ").trim() || [p.brand, p.name].filter(Boolean).join(" ").trim()).replace(/\s+/g, " ");
}
const soldUrl = (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13`;

(async () => {
  const catalog = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  if (!catalog.length) { console.log("used_catalog が空"); return; }
  console.log(`対象 ${Math.min(catalog.length, LIMIT)} / ${catalog.length}件`);

  await get("https://www.ebay.com/"); // warmup（cookie）
  await sleep(1500);

  let confirmed = 0, thin = 0, blocked = 0;
  let n = 0;
  for (const p of catalog) {
    if (n >= LIMIT) break;
    n++;
    const q = soldQuery(p);
    const url = soldUrl(q);
    p.ebaySoldUrl = url; // 根拠リンクは常に保存（数値が確定しなくても確認はできる）
    try {
      const r = await get(url, "https://www.ebay.com/");
      if (r.status !== 200 || /captcha|verify you|Pardon/i.test(r.html.slice(0, 3000))) { blocked++; console.log(`  [検問] ${q}`); await jitter(); continue; }
      const parsed = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, false); // 中古=新品縛りしない
      if (parsed.prices.length >= 3) {
        const med = trimmedMedian(parsed.prices);
        p.ebayMedianJpy = med;
        p.soldCount = parsed.prices.length;
        p.ebayConfirmed = true;
        p.profitJpy = netProfitJPY(p.buyJpy, med);
        p.profitRate = Math.round((p.profitJpy / med) * 100);
        confirmed++;
        console.log(`  ✓ ${q.padEnd(28)} 落札${parsed.prices.length}件 中央¥${med} → 益¥${p.profitJpy}(${p.profitRate}%)`);
      } else {
        p.ebayConfirmed = false; // 件数不足＝系列中央値の目安のまま（根拠リンクは付く）
        thin++;
        console.log(`  ・ ${q.padEnd(28)} 落札${parsed.prices.length}件（不足→系列目安を維持）`);
      }
    } catch (e) { console.log(`  [err] ${q}: ${e.message.slice(0, 40)}`); }
    await jitter();
  }

  // 型番確定後に赤字化したものは「利益カタログ」から外す（純益¥500以下）。再ソート。
  const before = catalog.length;
  const kept = catalog.filter((p) => !p.ebayConfirmed || p.profitJpy > 500).sort((a, b) => b.profitJpy - a.profitJpy);
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(kept) });
  console.log(`\n=== 型番確定 ${confirmed}件 / 件数不足 ${thin}件 / 検問 ${blocked}件 ===`);
  console.log(`赤字化で除外 ${before - kept.length}件 → used_catalog 計 ${kept.length}件`);
})();
