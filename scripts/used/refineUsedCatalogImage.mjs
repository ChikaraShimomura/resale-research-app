#!/usr/bin/env node
// scripts/used/refineUsedCatalogImage.mjs
// 【画像一致リファイナ（型番なしブランド品の別レール）】
// 現行 refineUsedCatalogEbay.mjs は「型番→eBay落札タイトル一致」で確定するため、型番(item-code)が無いブランド品
// (バッグ/財布/ジュエリー/アパレル等)は refine:139 で確定できず落ちる。このワーカーはその落ちる個体を救う:
//   ① 日本語ブランド品名 → 限定的な英語クエリに変換(jaToEnglishBrandQuery)
//   ② その語で eBay落札検索(中古限定 LH_ItemCondition=3000) → 上位3件(価格+画像+タイトル)
//   ③ 各件の画像を Hard-Off画像と fail-closed 画像一致(imageSameProduct)で照合
//   ④ 上位3件中 MIN_IMAGE_MATCH(既定2) 件以上が 'same' → 一致落札の中央値で ebayConfirmed=true / confirmMethod="image"
// ★同一性は厳格に(Haiku→Sonnet両YES・取得失敗=非確定)。状態/付属品は「中古落札の中央値」で価格側に反映(同一性判定では状態で弾かない)。
// ★非破壊: このワーカーは確定を「付ける」だけ。未確定品の drop/kept-filter は現行 refine に委ねる(二重ドロップ/競合回避)。
// 住宅IP・低頻度(warmup1回+間隔+ジッタ)。落札取得は ebaySoldWorker.mjs のSSOTを再利用。Pixel/Termux で壁時計スケジュール実行。
// 使い方: node scripts/used/refineUsedCatalogImage.mjs [limit]
import fs from "node:fs";
import { get, parseSoldWithin } from "../ebaySoldWorker.mjs";
import { landedSubtractJpy, ebayFeeRate, ebayFeeFixedJpy } from "../../app/lib/ebay/landedCostCore.mjs";
import { ebayCompetition, hasEbayKeys } from "./ebayCompetition.mjs";
import { upscaleImageflux } from "../../app/lib/imagefluxUpscale.mjs";
import { jaToEnglishBrandQuery, imageSameProduct } from "../../app/lib/ebay/brandMatch.mjs";

const USD_JPY = 155;
const WINDOW_DAYS = 365;
const GAP_MS = Number(process.env.EBAY_GAP_MS) || 8000;
const LIMIT = Number(process.env.IMG_REFINE_LIMIT || process.argv[2]) || 8; // 小バッチ(画像ワーカーはVision呼び出しがあるので更に控えめ)
const TOP_N = Number(process.env.IMG_TOP_N) || 3;                 // 落札ヒットの上位何件を照合するか
const MIN_IMAGE_MATCH = Number(process.env.MIN_IMAGE_MATCH) || 2; // 上位N件中この数以上 'same' で確定(ユーザー指示: 3件中2件)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(Math.round(GAP_MS * (1 + Math.random())));

function envv(k) {
  if (process.env[k]) return process.env[k];
  try { const e = fs.readFileSync(".env.local", "utf8"); const m = e.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; } catch { return ""; }
}
const KV_URL = envv("KV_REST_API_URL") || envv("UPSTASH_REDIS_REST_URL");
const KV_TOK = envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN");

function netProfitJPY(buyJpy, sellJpy, category) {
  const fee = sellJpy * ebayFeeRate(category) + ebayFeeFixedJpy();
  const subtract = landedSubtractJpy(category, sellJpy / USD_JPY);
  return Math.round(sellJpy - fee - subtract - buyJpy);
}
function trimmedMedian(prices) {
  const ps = prices.slice().sort((a, b) => a - b);
  const raw = ps[Math.floor(ps.length / 2)];
  const kept = ps.filter((v) => v >= raw * 0.4 && v <= raw * 2.5);
  const k = kept.length ? kept : ps;
  return k[Math.floor(k.length / 2)];
}
const soldUrl = (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isNew = (s) => /^new\b|new with|new without|new \(other|brand\s?new|新品|未使用|未開封|dead\s?stock|デッドストック/i.test((s || "").trim());
// 型番の日本語ノイズを除去した ASCII 断片（refineと同じ判定＝「型番が短い/無い＝code空ブランド品」を選ぶ）。
const stripNoise = (code) => String(code || "").replace(/[【（(][^】）)]*[】）)]/g, " ").replace(/※.*$/g, " ").replace(/[^\x00-\x7F]/g, " ").replace(/\s+/g, " ").trim();
const shortCode = (p) => norm(stripNoise(p.code)).length < 4; // refine:139 が捨てる集合＝このワーカーの対象
// このワーカーの対象＝ブランド品(brand有)・型番なし/短い・時計以外(時計は型番レール)・画像あり。
const isBrandCandidate = (p) => !!p.brand && shortCode(p) && p.cat !== "腕時計" && !!p.imageUrl;

(async () => {
  // AI判定は「ローカルのANTHROPIC_API_KEY」or「KV鍵経由でVercelプロキシ(/api/internal/ai-brand)」のどちらかで実行できる。
  // ★Pixelはローカルキーを持たずproxyを使うので、ローカルキーの有無だけで no-op してはいけない(旧ガードのバグ:キー無しで即return)。
  //   ローカルキーもKV鍵(=proxy認証)も無い時だけ無効。brandMatch側が USE_PROXY で自動フォールバックする。
  if (!envv("ANTHROPIC_API_KEY") && !(envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN"))) {
    console.log("ANTHROPIC鍵もKV鍵も無し → 画像一致レール無効(AI不可)"); return;
  }
  console.log(`AI経路: ${envv("ANTHROPIC_API_KEY") ? "ローカルAnthropic直" : "Vercelプロキシ(/api/internal/ai-brand・KV鍵SHA256認証)"}`);
  const catalog = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  if (!catalog.length) { console.log("used_catalog が空"); return; }
  console.log(`eBay競合鍵: ${hasEbayKeys() ? "あり ✓" : "なし→競合数スキップ"}`);

  // 確定不能(画像一致せず)スキップキャッシュ＝hardoffUrl キー(code空なので型番キーは使えない)。TTL内は再scrapeしない。
  const UNCONF_TTL_MS = (Number(process.env.IMG_UNCONFIRMABLE_TTL_DAYS) || 21) * 864e5;
  const nowIso = new Date().toISOString();
  const unconf = await (async () => {
    try { const r = (await (await fetch(`${KV_URL}/get/ebay_unconfirmable_img`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result; const o = r ? JSON.parse(r) : {}; return o && typeof o === "object" ? o : {}; } catch { return {}; }
  })();
  const unconfKey = (p) => p.hardoffUrl || p.id || "";
  const isUnconfFresh = (p) => { const t = unconf[unconfKey(p)]; return !!t && (Date.now() - Date.parse(t)) < UNCONF_TTL_MS; };

  // 対象: ブランド候補で、未画像確定＆スキップキャッシュ外を優先。既に画像確定済みは後ろ(再検証は枠が余った時だけ)。
  const cands = catalog.filter(isBrandCandidate);
  const fresh = cands.filter((p) => p.confirmMethod !== "image" && !isUnconfFresh(p));
  const reverify = cands.filter((p) => p.confirmMethod === "image"); // 既存の画像確定を薄く再検証(枠が余れば)
  const order = [...fresh, ...reverify];
  console.log(`ブランド候補 ${cands.length}件 / 今回対象 ${Math.min(order.length, LIMIT)}件（新規 ${fresh.length}・再検証 ${reverify.length}・上位${TOP_N}件中${MIN_IMAGE_MATCH}件一致で確定）`);
  if (!order.length) { console.log("対象なし(全てスキップTTL内 or 候補ゼロ)"); return; }

  await get("https://www.ebay.com/"); await sleep(1500); // warmup

  let confirmed = 0, unconfirmed = 0, blocked = 0, skipped = 0, n = 0;
  const changedIds = new Set();
  for (const p of order) {
    if (n >= LIMIT) break;
    n++;
    // ① 日本語名 → 限定英語クエリ
    const enName = await jaToEnglishBrandQuery(p.brand, p.name, p.cat);
    if (!enName) { skipped++; console.log(`  ? ${(p.brand + " " + p.name).slice(0, 30)} 英語変換不可(AI不通/キー)→今回スキップ(unconfに入れない)`); continue; }
    p.enName = enName;
    const q = enName;
    p.ebaySoldUrl = soldUrl(q);
    // ② eBay落札検索(中古限定)
    let r;
    try { r = await get(soldUrl(q), "https://www.ebay.com/"); } catch (e) { console.log(`  [err] ${q}: ${e.message.slice(0, 30)}`); await jitter(); continue; }
    if (r.status !== 200 || /captcha|verify you|Pardon/i.test(r.html.slice(0, 3000))) { blocked++; console.log(`  [検問] ${q}（再確認待ち）`); await jitter(); continue; }
    const { cards } = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, false);
    // 中古の実落札のみ(新品タイトル除外)・画像URLがあるものを上位TOP_N件
    const top = cards.filter((c) => c.img && !isNew(c.cond) && !isNew(c.title)).slice(0, TOP_N);
    if (!top.length) { unconf[unconfKey(p)] = nowIso; unconfirmed++; console.log(`  ・ ${q.slice(0, 30).padEnd(30)} 中古落札0件→確定せず`); await jitter(); continue; }
    // ③ 上位N件を画像一致(fail-closed)。'same' の落札だけ相場に採用。
    const matched = [];
    for (const c of top) {
      const v = await imageSameProduct(p.imageUrl, c.img, { titleA: `${p.brand} ${p.name}`.trim(), titleB: c.title });
      if (v === "same") matched.push(c);
    }
    // ④ 判定
    if (matched.length >= MIN_IMAGE_MATCH) {
      const med = trimmedMedian(matched.map((c) => c.price));
      p.ebayMedianJpy = med; p.soldCount = matched.length; p.ebayConfirmed = true; p.confirmMethod = "image";
      p.profitJpy = netProfitJPY(p.buyJpy, med, p.cat); p.profitRate = p.buyJpy > 0 ? Math.round((p.profitJpy / p.buyJpy) * 100) : 0;
      const m0 = matched[0];
      p.matchedEbayUrl = m0.url; p.matchedEbayImageUrl = m0.img; p.matchedEbayTitle = m0.title;
      const comp = await ebayCompetition(q); if (comp != null) p.ebayActiveCount = comp;
      delete unconf[unconfKey(p)];
      confirmed++; changedIds.add(p.id);
      console.log(`  ✓ ${q.slice(0, 28).padEnd(28)} 画像一致${matched.length}/${top.length} 中央¥${med} → 益¥${p.profitJpy}(${p.profitRate}%)`);
    } else {
      unconf[unconfKey(p)] = nowIso; unconfirmed++;
      console.log(`  ・ ${q.slice(0, 28).padEnd(28)} 画像一致${matched.length}/${top.length}(<${MIN_IMAGE_MATCH})→確定せず`);
    }
    await jitter();
  }

  // ★書き戻し(非破壊): 変異したオブジェクトを含む catalog をそのまま全件SET。未確定品は落とさない(drop は現行refineに委ねる)。
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(catalog) });
  // スキップキャッシュ掃除＆書き戻し(TTLでKV側も自然失効)。
  for (const k of Object.keys(unconf)) { const t = Date.parse(unconf[k]); if (!t || (Date.now() - t) >= UNCONF_TTL_MS) delete unconf[k]; }
  await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify([["SET", "ebay_unconfirmable_img", JSON.stringify(unconf), "EX", String(90 * 24 * 3600)]]) });
  // 出品用 psnap は「今回画像確定/変化した品」だけ書く(変化分のみ＝KV書込最小化の不変条件を踏襲)。coreKeyword は英語名(eBay検索が効く)。
  const snapCmds = catalog.filter((p) => p.id && changedIds.has(p.id)).map((p) => ["SET", `psnap:${p.id}`, JSON.stringify({
    id: p.id, title: `${p.brand} ${p.name}`.trim(), imageUrl: upscaleImageflux(p.imageUrl), images: p.imageUrl ? [upscaleImageflux(p.imageUrl)] : [],
    category: p.cat || "中古", coreKeyword: p.enName || [p.brand, p.name].filter(Boolean).join(" ").trim(), brand: p.brand, code: p.code,
    realAvgPrice: p.ebayMedianJpy, realMedianPrice: p.ebayMedianJpy, realProfit: p.profitJpy, realProfitRate: p.profitRate,
    realCount: p.soldCount || 1, soldBased: true, soldCount30d: p.soldCount, usedCondition: p.condition, ebayActiveCount: p.ebayActiveCount,
    confirmMethod: "image", matchedEbayUrl: p.matchedEbayUrl, matchedEbayImageUrl: p.matchedEbayImageUrl, matchedEbayTitle: p.matchedEbayTitle,
    source: { site: p.site || "hardoff", siteName: p.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: p.buyJpy, url: p.hardoffUrl },
  }), "EX", String(90 * 24 * 3600)]);
  if (snapCmds.length) await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(snapCmds) });

  console.log(`\n=== 画像一致で確定 ${confirmed}件 / 確定せず ${unconfirmed}件 / 検問 ${blocked}件 / 変換不可 ${skipped}件 ===`);
})();
