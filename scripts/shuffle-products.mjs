#!/usr/bin/env node
// scripts/shuffle-products.mjs — profitable_products を一度だけシャッフルする保守スクリプト。
// 利益率順に偏った既存データの並びを自然に崩す。Haiku/Browse は使わず KV の読み書きのみ。
//
// addedAt を「シャッフル順に降順（90日前を基準に1分ずつ）」へ振り直すことで、
// 以降の定期 refresh（addedAt 降順ソートで保存）でも並びが維持される。
// 今後 refresh が追加する新商品は現在時刻 addedAt なので、これらより上（新着）に来る。
//
// 必要env: KV_REST_API_URL, KV_REST_API_TOKEN（書き込みトークン）

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL = 480 * 3600; // refresh.mjs と同じ保持期間

if (!KV_URL || !KV_TOKEN) {
  console.error("KV_REST_API_URL / KV_REST_API_TOKEN が未設定です");
  process.exit(1);
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

async function kvSet(key, value, exSeconds = TTL) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([["SET", key, JSON.stringify(value), "EX", String(exSeconds)]]),
  });
  if (!res.ok) throw new Error(`kvSet ${key} HTTP ${res.status}`);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const products = await kvGet("profitable_products");
if (!Array.isArray(products) || products.length === 0) {
  console.error("profitable_products が空、または取得失敗。中断します。");
  process.exit(1);
}

console.log(`取得: ${products.length}件。シャッフルします。`);

shuffle(products);

const base = Date.now() - 90 * 24 * 3600 * 1000;
products.forEach((p, i) => {
  p.addedAt = new Date(base - i * 60000).toISOString();
});

await kvSet("profitable_products", products);

console.log(`完了: ${products.length}件をシャッフルして保存しました。`);
console.log(`先頭5件: ${products.slice(0, 5).map((p) => (p.title || "").slice(0, 24)).join(" / ")}`);
