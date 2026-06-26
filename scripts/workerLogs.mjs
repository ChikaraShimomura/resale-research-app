#!/usr/bin/env node
// scripts/workerLogs.mjs [--tail] — KVに溜まったワーカーログ(wlog:*)を読んで表示。
// 住宅IP常駐 Pixel が workerLog.mjs で push した各ジョブの最終実行(時刻/終了コード/gitコミット/ログ末尾)をPCから遠隔確認する。
import fs from "node:fs";

function env(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const URL = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const TOK = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
const KEYS = ["meta", "liveness", "gallery", "discover", "build", "refine"];
const showAllTail = process.argv.includes("--tail") || process.argv.includes("-t");

for (const k of KEYS) {
  let r = null;
  try {
    r = (await (await fetch(`${URL}/get/${encodeURIComponent("wlog:" + k)}`, { headers: { Authorization: `Bearer ${TOK}` } })).json()).result;
  } catch { /* noop */ }
  if (!r) { console.log(`\n■ ${k.padEnd(9)} (記録なし)`); continue; }
  const o = JSON.parse(r);
  const ago = Math.round((Date.now() - Date.parse(o.at)) / 60000);
  const flag = o.exit === 0 || o.exit === null ? "" : `  ⚠️exit=${o.exit}`;
  console.log(`\n■ ${k.padEnd(9)} ${o.at} (${ago}分前)${flag}  git=${o.git || "?"}`);
  // discover/build/refine/meta は既定で末尾を出す。--tail で全部。
  if (o.tail && (showAllTail || ["discover", "build", "refine", "meta"].includes(k))) {
    console.log(o.tail.split("\n").slice(-15).map((l) => "   | " + l).join("\n"));
  }
}
console.log("");
