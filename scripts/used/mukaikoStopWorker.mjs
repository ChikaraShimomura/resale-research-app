#!/usr/bin/env node
// scripts/used/mukaikoStopWorker.mjs
// 【無在庫(dropship)出品の売り切れ検知ワーカー・稼働中／termux-run.sh に配線】仕入れ元(ハードオフ)が売切/掲載終了になった
// 「無在庫の出品中(ebay_deals)」を実ページ照合で検知して deal.sourceStatus を立てる→ reconcile/auto-stop が eBay を自動停止する。
// ＝2026-07-01 の無在庫出品機能(EbayListingModal の dropship・publish が deal.dropship=true を立てる)の売切検知の本体。
//
// 【なぜこれが"無在庫"でだけ正しいか】
//   ・無在庫＝eBayに先に出品し、売れてから仕入れ元で買う。だから「仕入れ元が(eBay落札より先に)売切」=もう仕入れられない
//     ＝欠品キャンセルになる→eBay出品を止めるのが正しい。
//   ・⚠️有在庫(通常のハードオフ中古)では真逆＝ユーザーが先に買って手元に持ってから出すので、仕入れ元の売切は「買った証拠」。
//     止めたら手元在庫の正当な出品を潰す(2026-06-28に実害を出した)。だからこのワーカーは dropship 以外の deal を絶対に触らない。
//
// 【二重ロック(誤発火防止)】下記2条件を両方満たさないと何もしない:
//   1) env `MUKAIKO_STOP_ENABLED=1`（住宅IP機=Pixel の termux-run.sh でだけ有効化＝クラウドで暴発させない）
//   2) deal.dropship === true（publish が「無在庫で出した」出品にだけ立てる印・有在庫dealには付かない）
//   ＝reconcile 側も `if(!d.dropship)continue` で二重に有在庫を保護（sourceReconcile.ts）。
//
// 【カタログ隠し版(hardoffLivenessWorker)との違い】あちらは used_catalog の品を見て used_source_status(カタログ非表示)を立てるだけ。
//   こちらは ebay_deals の"出品中の無在庫品"を見て deal.sourceStatus を立てる＝カタログから外れた無在庫出品の売切も取りこぼさない。
//   実ページ判定/安全則は両者同一(schema.org availability+404・fail-open・1回再確認・ブレーキ・DRY既定)。
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN / MUKAIKO_STOP_ENABLED / MUKAIKO_STOP_DRY（本番書込は MUKAIKO_STOP_DRY=0）
import fs from "node:fs";

// ── 二重ロック①：明示有効化(=住宅IP機で MUKAIKO_STOP_ENABLED=1)されていなければ即終了（クラウド/手元での暴発防止） ──
if (process.env.MUKAIKO_STOP_ENABLED !== "1") {
  console.log("[mukaikoStopWorker] 休眠中: MUKAIKO_STOP_ENABLED=1 でない＝何もしません（termux-run.sh からのみ有効化）。");
  process.exit(0);
}

function env(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const KV_URL = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const KV_TOKEN = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
const H = { Authorization: `Bearer ${KV_TOKEN}` };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const HARDOFF_HOST = "netmall.hardoff.co.jp";
const GAP_MS = Number(process.env.MUKAIKO_STOP_GAP_MS ?? 1200);
const CONC = Number(process.env.MUKAIKO_STOP_CONC ?? 2);
const RECONFIRM_WAIT_MS = 1500;
const BRAKE_MIN_TOTAL = Number(process.env.MUKAIKO_STOP_BRAKE_MIN ?? 5);
const BRAKE_FLAG_RATIO = 0.7;
const MAX_ITEMS = Number(process.env.MUKAIKO_STOP_MAX ?? 800);
const DRY = process.env.MUKAIKO_STOP_DRY !== "0"; // 既定DRY。本番書込は MUKAIKO_STOP_DRY=0 を明示した時だけ。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ── KV(生REST) ──
async function kvScan(match) {
  const keys = []; let cursor = "0", guard = 0;
  do {
    try {
      const res = await fetch(`${KV_URL}/scan/${cursor}?match=${encodeURIComponent(match)}&count=300`, { headers: H });
      const data = await res.json();
      if (!Array.isArray(data.result)) break;
      cursor = String(data.result[0]);
      if (Array.isArray(data.result[1])) keys.push(...data.result[1]);
    } catch { break; }
  } while (cursor !== "0" && ++guard < 100);
  return keys;
}
async function kvHgetallParsed(key) {
  try {
    const res = await fetch(`${KV_URL}/hgetall/${encodeURIComponent(key)}`, { headers: H });
    const arr = (await res.json()).result;
    if (!Array.isArray(arr)) return {};
    const o = {};
    for (let i = 0; i < arr.length; i += 2) { try { o[arr[i]] = JSON.parse(arr[i + 1]); } catch { o[arr[i]] = arr[i + 1]; } }
    return o;
  } catch { return {}; }
}
async function kvHget(key, field) {
  try {
    const res = await fetch(`${KV_URL}/hget/${encodeURIComponent(key)}/${encodeURIComponent(field)}`, { headers: H });
    const r = (await res.json()).result;
    if (r == null) return null;
    try { return JSON.parse(r); } catch { return r; }
  } catch { return null; }
}
async function kvHset(key, field, value) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([["HSET", key, field, JSON.stringify(value)]]),
    });
    return true;
  } catch (e) { console.error("kvHset error:", e.message); return false; }
}

const hardoffUrlOf = (s) => (s && String(s).includes(HARDOFF_HOST) ? String(s).split("?")[0] : null);

// ── 実ページ判定（有在庫版と同一） ──
async function probeOnce(url) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8", Accept: "text/html" }, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 || res.status === 503) return "blocked";
    if (res.status === 404 || res.status === 410) return "dead";
    if (!res.ok) return "unknown";
    const html = await res.text();
    if (html.length < 2000) return "unknown";
    const av =
      html.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/["']availability["']\s*:\s*["']([^"']+)["']/i)?.[1] || "";
    if (/OutOfStock|SoldOut|Discontinued/i.test(av)) return "soldout";
    if (/InStock|LimitedAvailability|PreOrder|BackOrder|PreSale/i.test(av)) return "alive";
    return "unknown";
  } catch { return "unknown"; }
}
async function probeConfirmed(url) {
  const first = await probeOnce(url);
  if (first === "alive" || first === "unknown" || first === "blocked") return first;
  await sleep(RECONFIRM_WAIT_MS);
  const second = await probeOnce(url);
  if (second === "soldout" || second === "dead") return second;
  return "unknown";
}

// ── メイン：無在庫(dropship=true)の出品中dealだけを対象に、売切→sourceStatus ──
async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定。中止。"); process.exit(1); }
  const startedAt = Date.now();

  // 二重ロック②：deal.dropship===true（無在庫で出した印・publishが立てる）の出品中dealだけ。有在庫dealは対象外。
  const byCode = new Map(); // productId -> { url, locations:[{key,field}] }
  const dealKeys = await kvScan("ebay_deals:*");
  for (const key of dealKeys) {
    const deals = await kvHgetallParsed(key);
    for (const [productId, d] of Object.entries(deals)) {
      if (!d || typeof d !== "object") continue;
      if (d.dropship !== true) continue;                 // ★無在庫の印が無いものは絶対に触らない（有在庫の保護）
      if (d.soldUsd != null || d.stoppedAt != null) continue;
      const url = hardoffUrlOf(d.sourceUrl);
      if (!url) continue;
      let e = byCode.get(productId);
      if (!e) { e = { url, locations: [] }; byCode.set(productId, e); }
      e.locations.push({ key, field: productId });
    }
  }
  if (byCode.size === 0) { console.log("対象なし(無在庫dropship=trueの出品中dealが無い)。終了。"); return; }

  const work = [...byCode.keys()].slice(0, MAX_ITEMS);
  console.log(`[無在庫] 出品中deal照合: ${work.length}件${DRY ? "  [DRY]" : ""}`);

  const verdicts = new Map();
  let idx = 0, blocked = false;
  async function runner() {
    while (idx < work.length) {
      const code = work[idx++];
      if (blocked) { verdicts.set(code, "unknown"); continue; }
      const v = await probeConfirmed(byCode.get(code).url);
      if (v === "blocked") { blocked = true; verdicts.set(code, "unknown"); continue; }
      verdicts.set(code, v);
      await sleep(GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONC }, runner));
  if (blocked) { console.log("⚠️ 429/503で打ち切り(fail-open)。"); return; }

  const decided = [...verdicts.values()];
  const flag = decided.filter((v) => v === "soldout" || v === "dead").length;
  if (decided.length >= BRAKE_MIN_TOTAL && flag / decided.length > BRAKE_FLAG_RATIO) {
    console.log(`⚠️ フラグ過多(${flag}/${decided.length})→破棄(fail-open)。`); return;
  }

  let setSold = 0, setDead = 0, cleared = 0;
  for (const code of work) {
    const v = verdicts.get(code);
    if (v === "unknown") continue;
    for (const { key, field } of byCode.get(code).locations) {
      const fresh = await kvHget(key, field);
      if (!fresh || typeof fresh !== "object" || fresh.dropship !== true) continue;
      if (fresh.soldUsd != null || fresh.stoppedAt != null) continue;
      const cur = fresh.sourceStatus ?? null;
      if (v === "soldout" || v === "dead") {
        if (cur === v) continue;
        if (!DRY) await kvHset(key, field, { ...fresh, sourceStatus: v, sourceCheckedAt: nowIso(), sourceCheckedBy: "dropship-hardoff" });
        if (v === "soldout") setSold++; else setDead++;
      } else if (v === "alive" && cur != null) {
        if (!DRY) { const next = { ...fresh, sourceCheckedAt: nowIso(), sourceCheckedBy: "dropship-hardoff" }; delete next.sourceStatus; await kvHset(key, field, next); }
        cleared++;
      }
    }
  }
  const sec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`${DRY ? "[DRY] " : ""}完了: [無在庫出品中] 売切 ${setSold}/掲載終了 ${setDead}/復活解除 ${cleared} (${sec}s)`);
  console.log(DRY ? "→ DRYなのでKV未書込。本番は MUKAIKO_STOP_DRY=0。" : "→ reconcile/auto-stop が eBay 出品を自動停止。");
}

main().catch((e) => { console.error("mukaikoStopWorker fatal:", e); process.exit(1); });
