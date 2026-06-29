#!/usr/bin/env node
// scripts/used/backfillCompetition.mjs
// 既存の「確定済み(ebayConfirmed)」カタログ品に eBay競合数(ebayActiveCount)をまとめて取得して焼き込む/更新する。
// 型番リファイナ(refine)は「型番が確定した瞬間」にしか競合数を付けないため、
//   ① 鍵が無くて未取得だった既存確定品の穴埋め
//   ② 時間が経って競合数がドリフトした品の再取得（BACKFILL_ALL=1）
// に使う。公式 Browse API（captchaなし）なので住宅IP不要・PCからでも可。EBAY_APP_ID/EBAY_CLIENT_SECRET が必要。
//
// ⚠️ used_catalog 全体を read→更新→write するため、refine ワーカー稼働中に走らせると書き込みが衝突しうる。
//    推奨：ワーカーを止めて実行 → 終わったらワーカー再起動（穴埋めは一度きりでよい）。
//
// 使い方:
//   node scripts/used/backfillCompetition.mjs            … ebayActiveCount 未取得の確定品だけ
//   BACKFILL_ALL=1 node scripts/used/backfillCompetition.mjs   … 確定品すべてを再取得（ドリフト更新）
//   BACKFILL_LIMIT=50 …で1回の上限を制御（既定は全件）。EBAY_GAP_MS で間隔(既定1200ms)。
import fs from "node:fs";
import { ebayCompetition, hasEbayKeys } from "./ebayCompetition.mjs";

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
const GAP_MS = Number(process.env.EBAY_GAP_MS) || 1200; // 公式API＝captcha無し。軽めの間隔でレート保護。
const ALL = process.env.BACKFILL_ALL === "1";
const LIMIT = Number(process.env.BACKFILL_LIMIT) || Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// refine と同じクエリ規則：ブランド + 型番（"-"→空白。eBayは "-" を NOT 演算子に取るため落札/出品が消える）。
function queryFor(p) {
  const codeQ = (p.code || "").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return [p.brand, codeQ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

(async () => {
  if (!hasEbayKeys()) {
    console.log("EBAY_APP_ID / EBAY_CLIENT_SECRET が無いため中止。.env.local に追加して再実行してください。");
    return;
  }
  if (!KV_URL || !KV_TOK) { console.log("KV 接続情報が無いため中止。"); return; }

  const catalog = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  if (!catalog.length) { console.log("used_catalog が空"); return; }

  const confirmed = catalog.filter((p) => p.ebayConfirmed);
  // targets は catalog 内オブジェクトへの参照＝ここで ebayActiveCount を書くと catalog ごと更新される。
  const targets = confirmed.filter((p) => (ALL || p.ebayActiveCount == null) && p.brand && p.code);
  console.log(`確定 ${confirmed.length}件 / 対象 ${Math.min(targets.length, LIMIT)}件（${ALL ? "全確定品を再取得" : "未取得のみ"}・間隔${GAP_MS}ms）`);

  const got = [];
  let miss = 0, n = 0;
  for (const p of targets) {
    if (n >= LIMIT) break;
    n++;
    const q = queryFor(p);
    const comp = await ebayCompetition(q);
    if (comp != null) { p.ebayActiveCount = comp; got.push(p); console.log(`  ✓ ${q.padEnd(30)} 競合 ${comp}件`); }
    else { miss++; console.log(`  ・ ${q.padEnd(30)} 取得不可（スキップ）`); }
    await sleep(GAP_MS);
  }

  // used_catalog 書き戻し（配信 getUsedCatalog がこれを読む＝カードの競合バッジに即反映）。
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(catalog) });

  // 出品フロー用 psnap:{id} の ebayActiveCount も即時パッチ（取得できた品だけ）。TTL35日で維持。
  let psnapUpdated = 0;
  for (const p of got) {
    if (!p.id) continue;
    try {
      const cur = (await (await fetch(`${KV_URL}/get/psnap:${encodeURIComponent(p.id)}`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result;
      if (!cur) continue;
      const snap = JSON.parse(cur);
      snap.ebayActiveCount = p.ebayActiveCount;
      await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify([["SET", `psnap:${p.id}`, JSON.stringify(snap), "EX", String(35 * 24 * 3600)]]) });
      psnapUpdated++;
    } catch { /* psnap更新失敗は無視（used_catalog側は更新済み） */ }
  }

  console.log(`\n=== 競合数 焼き込み ${got.length}件 / 取得不可 ${miss}件 / psnap更新 ${psnapUpdated}件 → used_catalog 計 ${catalog.length}件 ===`);
})();
