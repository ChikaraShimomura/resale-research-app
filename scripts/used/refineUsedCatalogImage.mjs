#!/usr/bin/env node
// scripts/used/refineUsedCatalogImage.mjs
// 【名前/画像一致リファイナ（型番レールで確定できない品を救う別レール）】
// 現行 refineUsedCatalogEbay.mjs は「型番→eBay落札タイトル一致」で確定するため、型番が無い/型番がeBayタイトルに出ない品は
// 落札0/不一致で確定できず落ちる。このワーカーはその落ちる個体を「名前一致→画像一致」の二段で救う（ユーザー指示2026-07-11:
// カタログ最大化・精度70%維持でOK）:
//   ① 日本語ブランド品名 → 限定的な英語クエリに変換(jaToEnglishBrandQuery)
//   ② その語で eBay落札検索(中古限定 LH_ItemCondition=3000) → 上位TOP_N件(価格+画像+タイトル)
//   ③a【名前一致・無料】識別トークン(型番/ライン名)を含む中古落札が MIN_NAME_MATCH件以上＋価格が揃えば → 名前で確定(画像AIを叩かない)
//   ③b【画像一致・AI】名前で決まらない品だけ imageSameProduct(緩め: 上位N件中 MIN_IMAGE_MATCH=1件 'same') → 画像で確定
//   ④ 一致落札の中央値で ebayConfirmed=true / confirmMethod="name"|"image"。状態/付属品は中央値で価格側に反映。
// ★対象＝未確定のブランド品全般(型番なし＋型番失敗＋時計も)。名前一致を先に置いて画像AIの叩き回数を最小化＝コストを抑えつつ最大化。
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
const LIMIT = Number(process.env.IMG_REFINE_LIMIT || process.argv[2]) || 40; // 1回の処理件数(07-09: 8→30／07-14: 30→40=常時1000件目標のバックログ消化加速)。eBay検索は1候補=1回・8s間隔+warmupでcaptcha安全域。上げる時は wlog:imgrefine の検問数を監視。
const TOP_N = Number(process.env.IMG_TOP_N) || 4;                 // 画像照合(AI)に回す上位件数(コストの蛇口)
const NAME_TOP_N = Number(process.env.NAME_TOP_N) || 8;           // ★名前一致(無料)はより広く見る=上位8件をスキャン(ヒット率UP・AIコスト不変)
const MIN_NAME_MATCH = Number(process.env.MIN_NAME_MATCH) || 2;   // ★名前一致(無料)：識別トークン(型番/ライン名)を含む中古落札がこの件数以上＋価格が揃えば画像AIを叩かず確定。
const MIN_IMAGE_MATCH = Number(process.env.MIN_IMAGE_MATCH) || 1; // ★2→1(2026-07-11 カタログ最大化・精度70%運用)：名前で決まらない品は上位N件中1件でも画像'same'で確定。
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
const shortCode = (p) => norm(stripNoise(p.code)).length < 4;
// ★対象を拡張(2026-07-11・ユーザー指示「カタログ最大化・精度70%でOK」)：型番なしブランド品だけでなく
//   「まだ確定していないブランド品(型番refineで落札0/不一致だった品も含む)」全般。時計も含める(文字盤は識別しやすい)。
//   まず名前一致(無料)で確定を試み、曖昧な品だけ画像一致(AI)に回す＝コストを抑えつつ最大化。
const isRefineCandidate = (p) => !!p.brand && !!p.imageUrl && p.ebayConfirmed !== true;
// 名前一致の要＝識別トークン。モデルコード様(英字+数字連結: d80/wm51/scph50000)を最優先、無ければライン名(数字なしの最長語)。
const keyTokens = (name) => {
  const s = String(name || "").toLowerCase();
  const codes = (s.replace(/[-_]/g, "").match(/[a-z]+\d+[a-z0-9]*|\d+[a-z]+[a-z0-9]*/g) || []).filter((t) => t.length >= 3);
  if (codes.length) return [...new Set(codes)];
  const words = s.split(/[^a-z]+/).filter((t) => t.length >= 4 && !/^(with|body|used|only|the|and|for|new|pre|owned|vintage|japan|mint|near|rare|black|white|silver|gold)$/.test(t));
  return words.sort((a, b) => b.length - a.length).slice(0, 1);
};
const titleHasKey = (title, keys) => keys.length > 0 && norm(title).includes(norm(keys[0])); // 識別トークン(先頭=最有力)がタイトルに在るか

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
  const cands = catalog.filter(isRefineCandidate);
  const fresh = cands.filter((p) => !isUnconfFresh(p));
  // 優先＝型番なし/短い品(型番レールでは救えない)を先に、次に型番失敗品。スキップTTL内は除外済み。
  fresh.sort((a, b) => (shortCode(b) ? 1 : 0) - (shortCode(a) ? 1 : 0));
  const order = fresh;
  console.log(`未確定ブランド候補 ${cands.length}件 / 今回対象 ${Math.min(order.length, LIMIT)}件（名前一致≥${MIN_NAME_MATCH}件で無料確定→ダメなら画像上位${TOP_N}件中${MIN_IMAGE_MATCH}件で確定）`);
  if (!order.length) { console.log("対象なし(全てスキップTTL内 or 候補ゼロ)"); return; }

  await get("https://www.ebay.com/"); await sleep(1500); // warmup

  let confirmed = 0, unconfirmed = 0, blocked = 0, skipped = 0, n = 0, nameConf = 0, imgConf = 0;
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
    // 中古の実落札のみ(新品タイトル除外)・画像URLがあるもの。名前一致(無料)は広く NAME_TOP_N件・画像照合(AI)は上位 TOP_N件だけ(コストの蛇口)。
    const topAll = cards.filter((c) => c.img && !isNew(c.cond) && !isNew(c.title)).slice(0, NAME_TOP_N);
    const top = topAll.slice(0, TOP_N);
    if (!topAll.length) { unconf[unconfKey(p)] = nowIso; unconfirmed++; console.log(`  ・ ${q.slice(0, 30).padEnd(30)} 中古落札0件→確定せず`); await jitter(); continue; }

    let med = null, matched = null, method = null;
    // ③a 名前一致(無料・画像AIを叩かない)：識別トークン(型番/ライン名)を含む中古落札が MIN_NAME_MATCH件以上＋価格が揃えば確定。
    const keys = keyTokens(enName);
    const nameHits = topAll.filter((c) => titleHasKey(c.title, keys));
    if (nameHits.length >= MIN_NAME_MATCH) {
      const prices = nameHits.map((c) => c.price);
      const m = trimmedMedian(prices);
      const kept = prices.filter((v) => v >= m * 0.4 && v <= m * 2.5); // 価格が揃ってる(=同一商品らしい)かの担保
      if (kept.length >= MIN_NAME_MATCH) { med = m; matched = nameHits; method = "name"; }
    }
    // ③b 名前で決まらない→画像一致(AI・上位N件中 MIN_IMAGE_MATCH件 'same' で確定)
    if (method == null) {
      const imgMatched = [];
      for (const c of top) {
        const v = await imageSameProduct(p.imageUrl, c.img, { titleA: `${p.brand} ${p.name}`.trim(), titleB: c.title });
        if (v === "same") imgMatched.push(c);
      }
      if (imgMatched.length >= MIN_IMAGE_MATCH) { med = trimmedMedian(imgMatched.map((c) => c.price)); matched = imgMatched; method = "image"; }
    }
    // ④ 判定
    if (method != null && med != null) {
      p.ebayMedianJpy = med; p.soldCount = matched.length; p.ebayConfirmed = true; p.confirmMethod = method;
      p.profitJpy = netProfitJPY(p.buyJpy, med, p.cat); p.profitRate = p.buyJpy > 0 ? Math.round((p.profitJpy / p.buyJpy) * 100) : 0;
      const m0 = matched[0];
      p.matchedEbayUrl = m0.url; p.matchedEbayImageUrl = m0.img; p.matchedEbayTitle = m0.title;
      const comp = await ebayCompetition(q); if (comp != null) p.ebayActiveCount = comp;
      delete unconf[unconfKey(p)];
      confirmed++; if (method === "name") nameConf++; else imgConf++; changedIds.add(p.id);
      console.log(`  ✓ ${q.slice(0, 26).padEnd(26)} ${method === "name" ? "名前" : "画像"}一致${matched.length} 中央¥${med} → 益¥${p.profitJpy}(${p.profitRate}%)`);
    } else {
      unconf[unconfKey(p)] = nowIso; unconfirmed++;
      console.log(`  ・ ${q.slice(0, 26).padEnd(26)} 名前/画像とも不一致→確定せず`);
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
    confirmMethod: p.confirmMethod || "image", matchedEbayUrl: p.matchedEbayUrl, matchedEbayImageUrl: p.matchedEbayImageUrl, matchedEbayTitle: p.matchedEbayTitle,
    source: { site: p.site || "hardoff", siteName: p.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: p.buyJpy, url: p.hardoffUrl },
  }), "EX", String(90 * 24 * 3600)]);
  if (snapCmds.length) await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(snapCmds) });

  console.log(`\n=== 確定 ${confirmed}件（名前一致${nameConf}/画像一致${imgConf}） / 確定せず ${unconfirmed}件 / 検問 ${blocked}件 / 変換不可 ${skipped}件 ===`);
})();
