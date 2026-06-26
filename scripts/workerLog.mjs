#!/usr/bin/env node
// scripts/workerLog.mjs <key> [logfile] [exit]
// ワーカー各ジョブの「最終実行サマリ(時刻/終了コード/gitコミット/ログ末尾60行)」を KV `wlog:{key}` に push する。
// 目的: 住宅IP常駐の Pixel のログを KV 経由で PC 側から遠隔確認できるようにする（termux-run.sh が各ジョブ後に呼ぶ）。
// 読み出しは scripts/workerLogs.mjs。鍵は .env.local or 環境変数（Pixelの.env.localにKV鍵あり）。
import fs from "node:fs";
import { execSync } from "node:child_process";

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
const [, , key, logfile, exit] = process.argv;
if (!key || !URL || !TOK) {
  console.error("usage: node scripts/workerLog.mjs <key> [logfile] [exit] （要 KV_REST_API_URL/TOKEN）");
  process.exit(1);
}

let tail = "";
try {
  if (logfile && fs.existsSync(logfile)) {
    const lines = fs.readFileSync(logfile, "utf8").split(/\r?\n/);
    tail = lines.slice(-60).join("\n").slice(-6000); // 末尾60行・6000字まで
  }
} catch { /* noop */ }

let git = "";
// --oneline ＝ "短SHA 件名"。%形式のformatはWindows(cmd)で %cd% 等が誤展開されるため使わない（クロスプラットフォーム安全）。
try { git = execSync("git log -1 --oneline", { encoding: "utf8" }).split(/\r?\n/)[0].trim().slice(0, 120); } catch { /* noop */ }

const rec = { at: new Date().toISOString(), exit: exit !== undefined ? Number(exit) : null, git, tail };
// repo既定の pipeline 形式（SET key value EX ttl）。TTL14日。
const body = JSON.stringify([["SET", `wlog:${key}`, JSON.stringify(rec), "EX", String(14 * 24 * 3600)]]);
try {
  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOK}`, "Content-Type": "application/json" },
    body,
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
