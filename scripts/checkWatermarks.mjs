#!/usr/bin/env node
// scripts/checkWatermarks.mjs — 楽天画像の「透かし入り商品」を検知し一覧から除外する（手動実行・GitHub Actions）。
//
// 目的: 利益商品カタログ(profitable_products)の各商品のメイン画像を Haiku ビジョンで見て、
//       「店の透かし/ロゴ/URL/宣伝文が画像に焼き込まれているか」を判定。透かし入りは KVハッシュ
//       product_watermark に記録し、/api/products が配信時に一覧から除外する（商品データは消さない＝可逆）。
//
// コスト: Haikuビジョン課金が発生する(ユーザーが「AI検知で除外」を選択)。一度判定したらキャッシュして
//         再検査しない＝初回のみ全件、以降は新商品だけ。手動(workflow_dispatch)実行でコストを完全管理。

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const GAP_MS   = Number(process.env.WM_GAP_MS ?? 250);
const MAX_CHECK = Number(process.env.WM_MAX_CHECK ?? 1000); // 1回の検査上限(安全)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KV_HEADERS = { Authorization: `Bearer ${KV_TOKEN}` };

// ========== Upstash KV（checkLinks.mjs と同方式: 生REST fetch） ==========
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: KV_HEADERS });
    const data = await res.json();
    if (!data.result) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch { return null; }
}

async function kvHgetall(key) {
  try {
    const res = await fetch(`${KV_URL}/hgetall/${encodeURIComponent(key)}`, { headers: KV_HEADERS });
    const data = await res.json();
    const arr = data.result;
    if (!Array.isArray(arr)) return {};
    const obj = {};
    for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
    return obj;
  } catch { return {}; }
}

async function kvHset(key, field, value) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { ...KV_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify([["HSET", key, field, String(value)]]),
    });
  } catch (e) { console.error("kvHset error:", e.message); }
}

// 楽天サムネ(リサイズCDN)→ 原寸オリジナル（透かしを見やすくするため検知も原寸で）。imageFilter.ts と同じ変換。
function toOriginal(url) {
  if (/thumbnail\.image\.rakuten\.co\.jp\/@0_mall\//.test(url)) {
    return url.replace("thumbnail.image.rakuten.co.jp/@0_mall/", "image.rakuten.co.jp/").replace(/\?_ex=\d+x\d+/, "");
  }
  return url.replace(/_ex=\d+x\d+/, "_ex=1200x1200");
}

// Haikuで「画像に透かし/ロゴ/宣伝文が焼き込まれているか」を判定。'W'|'C'|null(判定不能=記録せず次回再試行)。
async function detectWatermark(imageUrl) {
  try {
    const img = await fetch(toOriginal(imageUrl), {
      headers: { Referer: "https://www.yushutsu-fukugyo.com/", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!img.ok) return null;
    const b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
    const mt = img.headers.get("content-type") ?? "image/jpeg";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 5,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "You are checking a Japanese e-commerce product image. " +
                  "Answer WATERMARK ONLY if a reseller/shop has DIGITALLY OVERLAID promotional graphics on top of the photo, such as: a store name or website URL, a price tag, or a badge like 送料無料 (free shipping), 保証 (warranty), SALE, クーポン (coupon), ポイント, %OFF. " +
                  "Answer CLEAN for everything else, INCLUDING: text or logos PRINTED on the product or its box/package (brand name, model number, e.g. '1/48 SCALE KIT'); official product-line or manufacturer logos that are part of the maker's own photo (e.g. S.H.Figuarts, Hasegawa, BANDAI, CASIO); and plain product or box-art photos with no shop overlay. " +
                  "When unsure, answer CLEAN. " +
                  "Answer with ONE word: WATERMARK or CLEAN.",
              },
              { type: "image", source: { type: "base64", media_type: mt, data: b64 } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const ans = (d?.content?.[0]?.text ?? "").toUpperCase();
    if (ans.includes("WATERMARK")) return "W";
    if (ans.includes("CLEAN")) return "C";
    return null;
  } catch { return null; }
}

async function main() {
  if (!KV_URL || !KV_TOKEN || !ANTHROPIC_API_KEY) {
    console.error("必須env未設定 (KV_REST_API_URL / KV_REST_API_TOKEN / ANTHROPIC_API_KEY)。中止。");
    process.exit(1);
  }
  const startedAt = Date.now();
  const products = await kvGet("profitable_products");
  if (!Array.isArray(products) || products.length === 0) {
    console.log("カタログが空 or 取得失敗。何もしない。");
    return;
  }
  const checked = await kvHgetall("product_watermark"); // {id: "1"|"0"} 判定済み

  let newW = 0, newC = 0, skipped = 0, unknown = 0, done = 0;
  for (const p of products) {
    const id = p?.id;
    const url = p?.imageUrl;
    if (!id || !url) continue;
    if (checked[id] != null) { skipped++; continue; } // 判定済み＝再検査しない(コスト節約)
    if (done >= MAX_CHECK) { console.log(`上限 ${MAX_CHECK} 件に達したので打ち切り(次回続き)。`); break; }
    const v = await detectWatermark(url);
    if (v === "W") { await kvHset("product_watermark", id, "1"); newW++; }
    else if (v === "C") { await kvHset("product_watermark", id, "0"); newC++; }
    else unknown++; // 判定不能は記録しない＝次回再試行
    done++;
    await sleep(GAP_MS);
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `透かし検知 完了: 透かし入り ${newW} / クリーン ${newC} / 判定不能 ${unknown} / 既判定スキップ ${skipped} ` +
    `(カタログ ${products.length}件, ${elapsedSec}s)。透かし入りは /api/products が一覧から除外。`
  );
}

main().catch((e) => { console.error("checkWatermarks fatal:", e); process.exit(1); });
