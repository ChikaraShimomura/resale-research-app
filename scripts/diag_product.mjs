#!/usr/bin/env node
// scripts/diag_product.mjs — 1商品IDが本番KVのどこに存在するか調べる読み取り専用の診断ツール。
// なぜマイページの各リスト(仕入れ中/出品中/輸出した)に出る・出ないのかを特定する。
// env: KV_REST_API_URL/KV_REST_API_TOKEN, DIAG_ID(楽天itemCode)。本番KVには書き込まない。

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ID = (process.env.DIAG_ID || "").trim();

async function kv(path) {
  const res = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!res.ok) return null;
  return (await res.json()).result;
}
async function scanKeys(pattern) {
  let cursor = "0", keys = [];
  do {
    const r = await kv(`scan/${cursor}?match=${encodeURIComponent(pattern)}&count=500`);
    if (!Array.isArray(r)) break;
    cursor = String(r[0]);
    if (Array.isArray(r[1])) keys.push(...r[1]);
  } while (cursor !== "0");
  return keys;
}
async function hget(key, field) {
  return kv(`hget/${encodeURIComponent(key)}/${encodeURIComponent(field)}`);
}

(async () => {
  if (!ID) { console.error("DIAG_ID 未指定"); process.exit(1); }
  console.log("=== 診断対象 ID:", ID, "===\n");

  // restored_products
  const inRestored = await hget("restored_products", ID);
  console.log("restored_products に在る?:", inRestored ? "YES" : "no");

  // ebay_sourcing:* （仕入れ中の元データ）
  const srcKeys = await scanKeys("ebay_sourcing:*");
  console.log(`\nebay_sourcing キー数: ${srcKeys.length}`);
  let srcHits = 0;
  for (const k of srcKeys) {
    const v = await hget(k, ID);
    if (v != null) { srcHits++; console.log(`  ★ ${k} に在る:`, String(v).slice(0, 120)); }
  }
  if (!srcHits) console.log("  → どの ebay_sourcing にも無い（＝『楽天で仕入れる』の記録が届いていない）");

  // ebay_deals:* （出品/販売台帳）
  const dealKeys = await scanKeys("ebay_deals:*");
  console.log(`\nebay_deals キー数: ${dealKeys.length}`);
  let dealHits = 0;
  for (const k of dealKeys) {
    const v = await hget(k, ID);
    if (v != null) {
      dealHits++;
      let d; try { d = typeof v === "string" ? JSON.parse(v) : v; } catch { d = v; }
      const actor = k.replace("ebay_deals:", "");
      // 同じactorの sku_map に出品SKUが在るか（=出品中として表示される条件 isPublished）
      const sku = `rr-${ID}`;
      const skuVal = await hget(`ebay_sku_map:${actor}`, sku);
      console.log(`  ★ ${k} に deal 在り: soldUsd=${d?.soldUsd ?? "なし"} title=${(d?.title || "").slice(0,30)} | sku_map(${sku})=${skuVal ? "在り(=出品中表示)" : "無し(=幽霊deal)"}`);
    }
  }
  if (!dealHits) console.log("  → どの ebay_deals にも無い（dealは原因ではない）");

  console.log("\n=== 結論の見方 ===");
  console.log("・sourcingに在る&dealに無い → 仕入れ中に出るはず（出ないならGETかキャッシュ）");
  console.log("・dealに在る(幽霊deal=sku_map無し&売却なし) → 仕入れ中GETが除外＝今回の主犯");
  console.log("・sourcingに無い → 記録が届いていない（sendBeacon/クリック側）");
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
