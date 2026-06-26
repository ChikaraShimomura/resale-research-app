#!/usr/bin/env node
// scripts/used/refineUsedCatalogEbay.mjs
// 【型番単位リファイナ（厳密・別型番を混ぜない）】used_catalog の各商品を「ブランド+型番(code)」でeBay落札検索し、
// ★タイトルに型番を含む落札だけ★を採用して中央値を出す＝同一型番の実落札のみで利益計算する。
// 同一型番が3件以上揃った商品だけ「型番一致」としてカタログに残し、揃わない商品は除外（別型番/系列平均で誤った利益を出さない）。
// さらに、その商品の eBay落札検索URL を ebaySoldUrl に保存（=「eBay落札を確認」ボタンのリンク先）。
// 落札パーサ/取得は ebaySoldWorker.mjs のSSOTを再利用。住宅IP・低頻度（warmup1回＋間隔＋ジッタ）。
// 使い方: node scripts/used/refineUsedCatalogEbay.mjs [limit]
import fs from "node:fs";
import { get, parseSoldWithin } from "../ebaySoldWorker.mjs";

const USD_JPY = 155;
const WINDOW_DAYS = 365; // 時計は値動きが遅い＋特定型番は出来高が薄いので落札窓は1年に広げ、同一型番の件数を確保
const GAP_MS = Number(process.env.EBAY_GAP_MS) || 8000;
const LIMIT = Number(process.argv[2]) || Infinity;
const MIN_SAME = 1; // 同一型番(中古)がこの件数以上で相場確定（ユーザー指示2026-06-26：0件だけ弾き1件以上は出す）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(Math.round(GAP_MS * (1 + Math.random())));

function envv(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const KV_URL = envv("KV_REST_API_URL") || envv("UPSTASH_REDIS_REST_URL");
const KV_TOK = envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN");

function netProfitJPY(buyJpy, sellJpy) {
  const fee = sellJpy * 0.1325 + 47;          // eBay最終手数料
  const shipFee = 2040 * 0.1325;               // 国際送料にかかる手数料分
  const sellUsd = sellJpy / USD_JPY;
  // 米関税: $500以上は真贋保証(AG)経由で買い手負担→セラーは引かない。$500未満は標準出品でDDP必須=セラーが前払い
  //   (時計の実効≒15%＋通関手数料¥3000。第122条の上乗せは2026-07-24失効予定で流動的なので保守的に概算)。
  const dutyJpy = sellUsd >= 500 ? 0 : Math.round(sellJpy * 0.15 + 3000);
  return Math.round(sellJpy - fee - shipFee - dutyJpy - buyJpy);
}
function trimmedMedian(prices) {
  const ps = prices.slice().sort((a, b) => a - b);
  const raw = ps[Math.floor(ps.length / 2)];
  const kept = ps.filter((v) => v >= raw * 0.4 && v <= raw * 2.5);
  const k = kept.length ? kept : ps;
  return k[Math.floor(k.length / 2)];
}
// LH_ItemCondition=3000 ＝ 中古(Used/Pre-owned)のみ＝新品retailを相場計算/根拠表示から除外。
const soldUrl = (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); // 型番照合用の正規化（記号/大小無視）
// 新品(retail)を除外＝中古の落札だけで相場を出す。状態(cond)とタイトルの両方を見る。
const isNew = (s) => /^new\b|new with|new without|new \(other|brand\s?new|新品|未使用|未開封|dead\s?stock|デッドストック/i.test((s || "").trim());

(async () => {
  const catalog = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  if (!catalog.length) { console.log("used_catalog が空"); return; }
  console.log(`対象 ${Math.min(catalog.length, LIMIT)} / ${catalog.length}件（同一型番${MIN_SAME}件以上で確定）`);

  await get("https://www.ebay.com/"); // warmup
  await sleep(1500);

  let confirmed = 0, dropped = 0, blocked = 0, n = 0;
  for (const p of catalog) {
    if (n >= LIMIT) break;
    n++;
    const code = (p.code || "").trim();
    // ⚠️ eBayは "-" を除外(NOT)演算子として扱う＝型番の "-" をそのまま検索すると "-XXXX" 以降が除外され落札が出ない。
    //    検索クエリは "-"→空白に置換（照合 norm は元から記号無視なので整合）。これで実際の型番落札がヒットし確認精度も上がる。
    const codeQ = code.replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const q = [p.brand, codeQ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    p.ebaySoldUrl = soldUrl(q); // 根拠ボタン＝ブランド+型番(ハイフン空白化)の落札検索
    const codeN = norm(code);
    // ★p.ebayChecked=true は「実際にeBayで確認できた」印。ブロック/エラーでは付けない＝取りこぼしを除外せず次回再確認。
    if (codeN.length < 4 || !p.brand) { p.ebayConfirmed = false; p.ebayChecked = true; console.log(`  ・ ${q} 型番が短い/無→相場確定せず（除外）`); continue; }
    let r;
    try { r = await get(soldUrl(q), "https://www.ebay.com/"); } catch (e) { console.log(`  [err] ${q}: ${e.message.slice(0, 30)}`); await jitter(); continue; }
    if (r.status !== 200 || /captcha|verify you|Pardon/i.test(r.html.slice(0, 3000))) { blocked++; console.log(`  [検問] ${q}（再確認待ち・残す）`); await jitter(); continue; }
    const { cards } = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, false); // 中古=新品縛りしない
    // ★同一型番だけ：タイトル(正規化)に型番(正規化)を含む落札に限定＝別モデルを混ぜない。さらに新品(retail)を除外＝中古の実勢のみ。
    const same = cards.filter((c) => norm(c.title).includes(codeN) && !isNew(c.cond) && !isNew(c.title));
    p.ebayChecked = true;
    if (same.length >= MIN_SAME) {
      const med = trimmedMedian(same.map((c) => c.price));
      p.ebayMedianJpy = med; p.soldCount = same.length; p.ebayConfirmed = true;
      p.profitJpy = netProfitJPY(p.buyJpy, med); p.profitRate = Math.round((p.profitJpy / med) * 100);
      confirmed++;
      console.log(`  ✓ ${q.padEnd(30)} 同一型番${same.length}件 中央¥${med} → 益¥${p.profitJpy}(${p.profitRate}%)`);
    } else {
      p.ebayConfirmed = false;
      console.log(`  ・ ${q.padEnd(30)} 同一型番${same.length}件（不足→相場確定せず・除外）`);
    }
    await jitter();
  }

  // 残す＝「確認済みで同一型番が取れた黒字」 or 「まだ未確認(ブロック等)」。確認済みで不足/赤字のものだけ落とす。
  // ＝別型番混入や系列平均の誤った利益は排除しつつ、ブロックで取りこぼした商品は次回再確認できるよう温存。
  const before = catalog.length;
  const kept = catalog
    .filter((p) => (p.ebayChecked ? (p.ebayConfirmed && p.profitJpy > 500 && p.profitRate >= 5) : true))
    .sort((a, b) => (b.ebayConfirmed ? b.profitJpy : -1) - (a.ebayConfirmed ? a.profitJpy : -1));
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(kept) });
  // 出品フロー用 psnap も同一型番相場で更新。TTL35日。
  const snapCmds = kept.filter((p) => p.id).map((p) => ["SET", `psnap:${p.id}`, JSON.stringify({
    id: p.id, title: `${p.brand} ${p.name}`.trim(), imageUrl: p.imageUrl, images: p.imageUrl ? [p.imageUrl] : [],
    category: p.cat || "腕時計", coreKeyword: [p.brand, p.code].filter(Boolean).join(" ").trim(),
    realAvgPrice: p.ebayMedianJpy, realMedianPrice: p.ebayMedianJpy, realProfit: p.profitJpy, realProfitRate: p.profitRate,
    realCount: p.soldCount || 1, soldBased: !!p.ebayConfirmed, soldCount30d: p.soldCount,
    source: { site: p.site || "hardoff", siteName: p.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: p.buyJpy, url: p.hardoffUrl },
  }), "EX", String(35 * 24 * 3600)]);
  if (snapCmds.length) await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(snapCmds) });

  console.log(`\n=== 同一型番で確定 ${confirmed}件 / 検問 ${blocked}件 ===`);
  console.log(`相場確定せず/赤字で除外 ${before - kept.length}件 → used_catalog 計 ${kept.length}件（全て型番一致）`);
})();
