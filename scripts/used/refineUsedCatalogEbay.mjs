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
const soldUrl = (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&_sop=13`;

// 時計の日本語モデル名→eBay英語表記（出品者が実際に使う語）。型番(ハードオフのコード)だけだと0件になるので、
// ライン名でフォールバックして「その機種に近い実落札」を必ず出す＝根拠ボタンが空にならない。
const WATCH_LINE = [
  [/オシアナス|OCEANUS/i, "Oceanus"], [/プロマスター|PROMASTER/i, "Promaster"], [/アテッサ|ATTESA/i, "Attesa"],
  [/プレザージュ|PRESAGE/i, "Presage"], [/プロスペックス|PROSPEX/i, "Prospex"], [/プロトレック|PRO\s?TREK/i, "Pro Trek"],
  [/エディフィス|EDIFICE/i, "Edifice"], [/オリエント\s?スター|ORIENT\s?STAR/i, "Orient Star"],
  [/Gショック|G-?SHOCK/i, "G-Shock"], [/アルピニスト|ALPINIST/i, "Alpinist"], [/バンビーノ|BAMBINO/i, "Bambino"],
  [/セイコー\s?5|SEIKO\s?5|5スポーツ|5SPORTS/i, "Seiko 5"], [/アストロン|ASTRON/i, "Astron"],
  [/ルキア|LUKIA/i, "Lukia"], [/ドルチェ|DOLCE/i, "Dolce"], [/ツヨサ|TSUYOSA/i, "Tsuyosa"],
  [/カマス|KAMASU/i, "Kamasu"], [/マコ\b|MAKO/i, "Mako"], [/レイ\b|\bRAY\b/i, "Ray"],
  [/ダイバー|DIVER/i, "diver"], [/クロノグラフ|CHRONOGRAPH/i, "chronograph"],
];
function watchLine(text) { for (const [re, en] of WATCH_LINE) if (re.test(text)) return en; return ""; }
// 検索tier（具体的→広め）。最初に十分な落札が返ったものを採用＝根拠リンクが空にならない。
function queryTiers(p) {
  const line = watchLine(`${p.name} ${p.code} ${p.modelKey}`);
  const tiers = [
    [p.brand, p.code].filter(Boolean).join(" "),        // ①ブランド+型番(最具体)
    [p.brand, line, p.code].filter(Boolean).join(" "),  // ②ブランド+ライン+型番
    [p.brand, line].filter(Boolean).join(" "),          // ③ブランド+ライン(広め)
  ].map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(tiers)];
}

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
    // 多段クエリ：①ブランド+型番 ②+ライン名 ③ブランド+ライン名。最も落札が返ったものを採用＝根拠リンクが空にならない。
    const tiers = queryTiers(p);
    let best = null;
    for (const q of tiers) {
      let r;
      try { r = await get(soldUrl(q), "https://www.ebay.com/"); } catch { await jitter(); continue; }
      if (r.status !== 200 || /captcha|verify you|Pardon/i.test(r.html.slice(0, 3000))) { blocked++; console.log(`  [検問] ${q}`); break; }
      const prices = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, false).prices; // 中古=新品縛りしない
      if (!best || prices.length > best.prices.length) best = { q, prices };
      await jitter();
      if (prices.length >= 5) break; // 十分なら広めtierは試さない（eBay負荷を抑える）
    }
    if (best && best.prices.length) {
      p.ebaySoldUrl = soldUrl(best.q); // 最善クエリ＝「eBay落札を確認」が実物を表示する
      if (best.prices.length >= 3) {
        const med = trimmedMedian(best.prices);
        p.ebayMedianJpy = med; p.soldCount = best.prices.length; p.ebayConfirmed = true;
        p.profitJpy = netProfitJPY(p.buyJpy, med); p.profitRate = Math.round((p.profitJpy / med) * 100);
        confirmed++;
        console.log(`  ✓ ${best.q.padEnd(30)} 落札${best.prices.length}件 中央¥${med} → 益¥${p.profitJpy}(${p.profitRate}%)`);
      } else {
        p.ebayConfirmed = false; thin++;
        console.log(`  ・ ${best.q.padEnd(30)} 落札${best.prices.length}件（不足→系列目安・リンクは最善クエリ）`);
      }
    } else {
      p.ebaySoldUrl = soldUrl(tiers[0] || p.brand); thin++;
    }
  }

  // 型番確定後に赤字化したものは「利益カタログ」から外す（純益¥500以下）。再ソート。
  const before = catalog.length;
  const kept = catalog.filter((p) => !p.ebayConfirmed || p.profitJpy > 500).sort((a, b) => b.profitJpy - a.profitJpy);
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(kept) });
  // 出品フロー用 psnap も型番相場で更新（カタログ表示とモーダルの想定売値を揃える）。TTL35日。
  const snapCmds = kept.filter((p) => p.id).map((p) => ["SET", `psnap:${p.id}`, JSON.stringify({
    id: p.id, title: `${p.brand} ${p.name}`.trim(), imageUrl: p.imageUrl, images: p.imageUrl ? [p.imageUrl] : [],
    category: p.cat || "腕時計", coreKeyword: [p.brand, p.code].filter(Boolean).join(" ").trim(),
    realAvgPrice: p.ebayMedianJpy, realMedianPrice: p.ebayMedianJpy, realProfit: p.profitJpy, realProfitRate: p.profitRate,
    realCount: p.soldCount || 1, soldBased: !!p.ebayConfirmed, soldCount30d: p.soldCount,
    source: { site: p.site || "hardoff", siteName: p.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: p.buyJpy, url: p.hardoffUrl },
  }), "EX", String(35 * 24 * 3600)]);
  if (snapCmds.length) await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(snapCmds) });
  console.log(`\n=== 型番確定 ${confirmed}件 / 件数不足 ${thin}件 / 検問 ${blocked}件 ===`);
  console.log(`赤字化で除外 ${before - kept.length}件 → used_catalog 計 ${kept.length}件`);
})();
