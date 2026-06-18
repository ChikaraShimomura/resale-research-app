#!/usr/bin/env node
// scripts/diagDcProbe.mjs — 決定版・データセンター(GitHub Actions=Azure)実測プローブ。読み取りのみ。
// 目的:
//  (1) 楽天Search APIの availability(=インデックス値,嘘の疑い) を生データで確認
//  (2) APIが返す本物 itemUrl を取得（番号≠スラッグ問題の回避）
//  (3) その本物URLをDC(Azure)から叩き、HTTPステータス + 実ページの <meta itemprop="availability"> を取得
//  (4) 「APIのavailability」vs「実ページの真実(削除404 / 売切OutOfStock / 生存InStock)」を出品中全件で比較
// env: KV_REST_API_URL/TOKEN, RAKUTEN_APP_ID/ACCESS_KEY/AFFILIATE_ID

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID || "";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const H = { Authorization: `Bearer ${KV_TOKEN}` };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kv(p) { const r = await fetch(`${KV_URL}/${p}`, { headers: H }); return (await r.json()).result; }
async function scan(m) { let c = "0", k = [], g = 0; do { const r = await kv(`scan/${c}?match=${encodeURIComponent(m)}&count=300`); if (!Array.isArray(r)) break; c = String(r[0]); if (Array.isArray(r[1])) k.push(...r[1]); } while (c !== "0" && ++g < 50); return k; }
function P(v) { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return v; } }

async function rakuten(itemCode) {
  const params = new URLSearchParams({ applicationId: RAKUTEN_APP_ID, accessKey: RAKUTEN_ACCESS_KEY, affiliateId: RAKUTEN_AFFILIATE_ID, itemCode, hits: "1", format: "json" });
  try {
    const r = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`, { headers: { Referer: "https://www.yushutsu-fukugyo.com/", Origin: "https://www.yushutsu-fukugyo.com", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
    let d = null; try { d = await r.json(); } catch {}
    if (d && d.error === "not_found") return { api: "not_found", url: null };
    if (r.ok && Array.isArray(d?.Items) && d.Items.length) {
      const it = d.Items[0]?.Item ?? d.Items[0];
      return { api: String(it?.availability), url: it?.itemUrl || null, name: (it?.itemName || "").slice(0, 30) };
    }
    if (r.ok && Array.isArray(d?.Items) && d.Items.length === 0) return { api: "0件", url: null };
    return { api: "unknown(" + r.status + ")", url: null };
  } catch (e) { return { api: "ERR:" + e.message, url: null }; }
}

async function probePage(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: AbortSignal.timeout(15000) });
    const onItem = r.url.includes("item.rakuten.co.jp");
    if (r.status >= 400) return { status: r.status, meta: null, verdict: "DEAD(" + r.status + ")" };
    if (!onItem) return { status: r.status, meta: null, verdict: "DEAD(→shop)" };
    const b = await r.text();
    const meta = (b.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)["']/i) || [])[1] || null;
    let verdict = "unknown";
    if (meta && /OutOfStock|SoldOut/i.test(meta)) verdict = "SOLDOUT";
    else if (meta && /InStock/i.test(meta)) verdict = "alive";
    else verdict = "200だがmeta無(" + b.length + ")";
    return { status: r.status, meta, verdict };
  } catch (e) { return { status: "ERR", meta: null, verdict: "ERR:" + e.message }; }
}

(async () => {
  console.log("=== 決定版DC実測: API availability vs 実ページ真実 ===");
  if (!RAKUTEN_APP_ID || !KV_URL) { console.log("env不足", { rak: !!RAKUTEN_APP_ID, kv: !!KV_URL }); process.exit(1); }
  const keys = await scan("ebay_deals:*");
  const codes = new Set();
  for (const k of keys) { const ds = P(await kv(`hgetall/${encodeURIComponent(k)}`)); if (!Array.isArray(ds)) continue; for (let i = 0; i < ds.length; i += 2) { const id = ds[i]; const d = P(ds[i + 1]); if (!d || typeof d !== "object") continue; if (d.soldUsd != null || d.stoppedAt != null) continue; codes.add(id); } }
  const list = [...codes];
  console.log("出品中 itemCode:", list.length, "件\n");
  let lie = 0;
  for (const code of list) {
    const a = await rakuten(code);
    await sleep(1100);
    let page = { verdict: "(API側にURL無=" + a.api + ")", status: "-", meta: "-" };
    if (a.url) { page = await probePage(a.url); await sleep(900); }
    const lying = (a.api === "1") && /DEAD|SOLDOUT/.test(page.verdict);
    if (lying) lie++;
    console.log(`${code.padEnd(24)} API_av=${String(a.api).padEnd(10)} PAGE[st=${String(page.status).padEnd(4)} meta=${String(page.meta).padEnd(22)} => ${page.verdict}]${lying ? "  <<< APIが嘘(在庫ありと返したが実際は死/売切)" : ""}`);
  }
  console.log(`\n=== 結論: ${list.length}件中 ${lie}件で「API=在庫あり」なのに実ページは死/売切。DCでもステータス+meta availabilityが取れれば検知成立 ===`);
})();
