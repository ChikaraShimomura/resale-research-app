#!/usr/bin/env node
// scripts/used/buildUsedCatalog.mjs
// 【A: 中古利益カタログ ビルダー】eBay起点→ハードオフ照合→利益判定→「儲かる型番」カタログをKVに書く。
// 中古に強いカテゴリで、eBay中古落札中央値(売り) × ハードオフ現在庫(買い) → 送料/関税/手数料後の純利益。
// 住宅IP・低頻度厳守：eBayは warmup1回＋長め間隔、失敗はスキップして貯める(再実行で埋まる)。
import fs from "node:fs";
import { fetchHardoff } from "./fetchHardoff.mjs";
import { ebayFeeRate, ebayFeeFixedJpy } from "../../app/lib/ebay/landedCostCore.mjs"; // 手数料SSOT(カテゴリ別FVF+海外決済+為替)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USD_JPY = 155;
const EBAY_GAP_MS = Number(process.env.EBAY_GAP_MS) || 15000; // eBay→eBay間隔

// 中古でeBay輸出が強いカテゴリ。{ebay:eBay検索語(英), hardoff:ハードオフ検索語, name:表示, cat:ジャンル}
const QUERIES = [
  { ebay: "Pioneer amplifier", hardoff: "Pioneer アンプ", cat: "音響" },
  { ebay: "Marantz amplifier", hardoff: "Marantz アンプ", cat: "音響" },
  { ebay: "Sansui amplifier", hardoff: "SANSUI アンプ", cat: "音響" },
  { ebay: "Technics turntable", hardoff: "Technics ターンテーブル", cat: "音響" },
  { ebay: "Denon amplifier", hardoff: "DENON アンプ", cat: "音響" },
  { ebay: "Nikon film camera", hardoff: "Nikon フィルムカメラ", cat: "カメラ" },
  { ebay: "Canon FD lens", hardoff: "Canon レンズ", cat: "カメラ" },
  { ebay: "Pentax lens k mount", hardoff: "PENTAX レンズ", cat: "カメラ" },
  { ebay: "Olympus OM camera", hardoff: "OLYMPUS カメラ", cat: "カメラ" },
  { ebay: "Roland synthesizer", hardoff: "Roland シンセ", cat: "楽器" },
  { ebay: "Boss guitar effects pedal", hardoff: "BOSS エフェクター", cat: "楽器" },
  { ebay: "Korg synthesizer", hardoff: "KORG シンセ", cat: "楽器" },
  { ebay: "Yamaha electric guitar japan", hardoff: "YAMAHA エレキギター", cat: "楽器" },
  { ebay: "Bandai Soul of Chogokin", hardoff: "超合金魂", cat: "ホビー" },
  { ebay: "Tamiya rc vintage", hardoff: "タミヤ RC", cat: "ホビー" },
];

let EBAY_COOKIE = "";
async function ebayWarmup() {
  try {
    const t = await fetch("https://www.ebay.com/", { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
    EBAY_COOKIE = (t.headers.get("set-cookie") || "").match(/[^;,\s]+=[^;,\s]+/g)?.join("; ") || "";
  } catch { /* noop */ }
}
async function ebaySoldMedianJPY(kw) {
  const u = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(kw)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: EBAY_COOKIE }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return { median: null, status: r.status };
  const b = await r.text();
  let vals = [...b.matchAll(/JPY\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((v) => v >= 800 && v <= 3000000);
  if (vals.length < 4) vals = [...b.matchAll(/\$\s?([\d,]+\.\d{2})/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * USD_JPY)).filter((v) => v >= 800 && v <= 3000000);
  if (vals.length < 4) return { median: null, status: 200, n: vals.length };
  vals.sort((a, b) => a - b);
  const raw = vals[Math.floor(vals.length / 2)];
  const kept = vals.filter((v) => v >= raw * 0.3 && v <= raw * 3).sort((a, b) => a - b);
  return { median: kept.length ? kept[Math.floor(kept.length / 2)] : raw, status: 200, n: vals.length };
}

// 送料/関税/eBay手数料後の純利益(JPY)。重量500g想定・送料は買い手負担(手数料分のみ計上)。
function netProfitJPY(buyJpy, sellJpy, category) {
  const rate = ebayFeeRate(category); // カテゴリ別実効手数料(FVF+海外決済+為替)。時計は15%。
  const fee = sellJpy * rate + ebayFeeFixedJpy();
  const shipFee = 2040 * rate;
  const dutyJpy = sellJpy / USD_JPY > 100 ? sellJpy * 0.1 + 230 : 0;
  return Math.round(sellJpy - fee - shipFee - dutyJpy - buyJpy);
}

function kvCreds() {
  // Pixel(Termux)は環境変数、ローカルPCは .env.local。process.env を優先しフォールバックする。
  let url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  let tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !tok) {
    try {
      const env = fs.readFileSync(".env.local", "utf8");
      const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };
      url = url || get("KV_REST_API_URL") || get("UPSTASH_REDIS_REST_URL");
      tok = tok || get("KV_REST_API_TOKEN") || get("UPSTASH_REDIS_REST_TOKEN");
    } catch { /* .env.local無し(Pixelは環境変数) */ }
  }
  return { url, tok };
}

(async () => {
  await ebayWarmup();
  const catalog = [];
  const byCat = {};
  let okCategories = 0; // eBay相場が取れたカテゴリ数（少なすぎる時は既存カタログを上書きしない安全弁）
  for (const q of QUERIES) {
    let er = { median: null }, items = [];
    try { er = await ebaySoldMedianJPY(q.ebay); } catch { /* skip */ }
    await sleep(2000);
    try { items = await fetchHardoff(q.hardoff); } catch { /* skip */ }
    if (!er.median) { console.log(`- ${q.hardoff.padEnd(22)} eBay取得不可(status=${er.status} n=${er.n ?? "-"}) ハ${items.length}`); await sleep(EBAY_GAP_MS); continue; }
    okCategories++;
    let prof = 0;
    for (const it of items) {
      if (!it.price) continue;
      const net = netProfitJPY(it.price, er.median, q.cat);
      const rate = net / er.median;
      if (net > 1000 && rate > 0.1) {
        prof++;
        catalog.push({
          modelKey: (it.code || it.name || "").slice(0, 60), brand: it.brand, name: it.name, code: it.code,
          cat: q.cat, ebayMedianJpy: er.median, buyJpy: it.price, condition: it.condition,
          profitJpy: net, profitRate: it.price > 0 ? Math.round((net / it.price) * 100) : 0, hardoffUrl: it.url, imageUrl: it.imageUrl, site: "hardoff",
        });
      }
    }
    byCat[q.cat] = (byCat[q.cat] || 0) + prof;
    console.log(`- ${q.hardoff.padEnd(22)} eBay中央¥${String(er.median).padEnd(8)} ハ${String(items.length).padStart(3)} → 利益◎${prof}`);
    await sleep(EBAY_GAP_MS);
  }
  // 利益額順に並べてKVへ。
  catalog.sort((a, b) => b.profitJpy - a.profitJpy);
  // 安全弁：eBayが大半ブロックされた回(取得カテゴリ<3)は既存カタログを潰さない＝部分結果での上書きを防ぐ。
  if (okCategories < 3) {
    console.log(`\n⚠️ eBay取得カテゴリ ${okCategories}件のみ→既存 used_catalog を維持（上書きしない）`);
  } else {
    try {
      const { url, tok } = kvCreds();
      await fetch(`${url}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(catalog) });
      console.log(`\n💾 KV used_catalog に ${catalog.length}件 書き込み（eBay取得 ${okCategories}カテゴリ）`);
    } catch (e) { console.log("KV書き込み失敗:", e.message); }
  }
  console.log(`\n=== A(ハードオフ)カタログ: 利益が出る商品 ${catalog.length}件 ===`);
  console.log("カテゴリ別:", Object.entries(byCat).map(([k, v]) => `${k}:${v}`).join("  "));
  console.log("上位例:");
  catalog.slice(0, 8).forEach((c) => console.log(`  [${c.cat}/${c.condition}] ${c.brand} ${c.name} 買¥${c.buyJpy}→売¥${c.ebayMedianJpy} 益¥${c.profitJpy}(${c.profitRate}%)`));
})();
