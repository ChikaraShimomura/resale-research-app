#!/usr/bin/env node
// scripts/checkListings.mjs — 「出品中」listing の楽天 死活/在庫チェック（GitHub Actions, ~30分ごと想定）
//
// 目的: 各ユーザーの出品中(未売却・未停止)の商品について、仕入れ元の楽天商品が
//       「売り切れ(soldout)」or「掲載終了/リンク切れ(dead)」になっていないかを ~30分ごとに確認し、
//       deal に sourceStatus フラグを立てる（マイページの出品中一覧に ⚠️ を表示）。
//       ※楽天API のみ＝無料・AI不使用。※出品の自動取り下げはしない（有在庫=手元在庫があり得るため、
//         検知後どうするかはユーザー判断。フラグ表示のみ）。
//
// 安全側: dead/soldout は1度だけ再確認してから確定（checkLinks と同方針）。
//   不明(429/5xx/timeout)は現状維持（フラグを変えない）。書き込みは状態が変わった deal だけ（KV節約）。
//
// 注: ebay_deals の hash field key = productId = 楽天 itemCode（"shop:NUMBER"）。これを直接死活判定できる。

const RAKUTEN_APP_ID       = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY   = process.env.RAKUTEN_ACCESS_KEY;
const RAKUTEN_AFFILIATE_ID = process.env.RAKUTEN_AFFILIATE_ID;
const KV_URL               = process.env.KV_REST_API_URL;
const KV_TOKEN             = process.env.KV_REST_API_TOKEN;

const RAKUTEN_GAP_MS = Number(process.env.RAKUTEN_GAP_MS ?? 1100); // 楽天API ~1req/sec
const MAX_ITEMS      = Number(process.env.LISTINGS_MAX_CHECK ?? 800); // 1回の上限(安全)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KV_HEADERS = { Authorization: `Bearer ${KV_TOKEN}` };

// ========== Upstash KV（checkLinks.mjs と同方式: 生REST fetch） ==========
async function kvScan(match) {
  const keys = [];
  let cursor = "0";
  let guard = 0;
  do {
    try {
      const res = await fetch(`${KV_URL}/scan/${cursor}?match=${encodeURIComponent(match)}&count=200`, { headers: KV_HEADERS });
      const data = await res.json();
      const result = data.result;
      if (!Array.isArray(result)) break;
      cursor = String(result[0]);
      if (Array.isArray(result[1])) keys.push(...result[1]);
    } catch {
      break;
    }
  } while (cursor !== "0" && ++guard < 1000);
  return keys;
}

// hash 全取得（値はJSON文字列なのでパースして返す）
async function kvHgetallParsed(key) {
  try {
    const res = await fetch(`${KV_URL}/hgetall/${encodeURIComponent(key)}`, { headers: KV_HEADERS });
    const data = await res.json();
    const arr = data.result;
    if (!Array.isArray(arr)) return {};
    const obj = {};
    for (let i = 0; i < arr.length; i += 2) {
      const v = arr[i + 1];
      try { obj[arr[i]] = typeof v === "string" ? JSON.parse(v) : v; } catch { obj[arr[i]] = v; }
    }
    return obj;
  } catch {
    return {};
  }
}

async function kvHget(key, field) {
  try {
    const res = await fetch(`${KV_URL}/hget/${encodeURIComponent(key)}/${encodeURIComponent(field)}`, { headers: KV_HEADERS });
    const data = await res.json();
    if (data.result == null) return null;
    try { return typeof data.result === "string" ? JSON.parse(data.result) : data.result; } catch { return data.result; }
  } catch {
    return null;
  }
}

async function kvHset(key, field, value) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { ...KV_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify([["HSET", key, field, JSON.stringify(value)]]),
    });
  } catch (e) {
    console.error("kvHset error:", e.message);
  }
}

// ========== 楽天 itemCode 死活＋在庫判定（checkLinks.mjs と同一ロジック） ==========
async function checkRakutenItem(itemCode) {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    affiliateId: RAKUTEN_AFFILIATE_ID,
    itemCode,
    hits: "1",
    format: "json",
  });
  try {
    const res = await fetch(`https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`, {
      headers: {
        Referer: "https://www.yushutsu-fukugyo.com/",
        Origin: "https://www.yushutsu-fukugyo.com",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(10000),
    });
    let data = null;
    try { data = await res.json(); } catch { /* 非JSON */ }
    if (data && data.error === "not_found") return { status: "dead", itemUrl: null };
    if (res.ok && data && Array.isArray(data.Items)) {
      if (data.Items.length === 0) return { status: "dead", itemUrl: null };
      const item = data.Items[0]?.Item ?? data.Items[0];
      const itemUrl = item?.itemUrl || null; // 本物のスラッグURL（住宅IPワーカーが実ページを叩くのに使う／番号URLは404）
      if (item && Number(item.availability) === 0) return { status: "soldout", itemUrl };
      return { status: "alive", itemUrl };
    }
    return { status: "unknown", itemUrl: null };
  } catch {
    return { status: "unknown", itemUrl: null };
  }
}

async function confirmStatus(itemCode) {
  const first = await checkRakutenItem(itemCode);
  if (first.status === "alive" || first.status === "unknown") return first;
  await sleep(1500);
  const second = await checkRakutenItem(itemCode);
  return { status: second.status, itemUrl: second.itemUrl ?? first.itemUrl };
}

// ========== メイン ==========
async function main() {
  if (!KV_URL || !KV_TOKEN || !RAKUTEN_APP_ID || !RAKUTEN_ACCESS_KEY) {
    console.error("必須env未設定 (KV / RAKUTEN)。中止。");
    process.exit(1);
  }
  const startedAt = Date.now();

  const dealKeys = await kvScan("ebay_deals:*");
  if (dealKeys.length === 0) {
    console.log("出品中dealなし（ebay_deals:* が0件）。何もしない。");
    return;
  }

  // 出品中(未売却・未停止)の deal を {key(actor), productId} で集める。itemCode は dedup。
  const targets = []; // { key, productId }
  const itemCodes = new Set();
  for (const key of dealKeys) {
    const deals = await kvHgetallParsed(key);
    for (const [productId, d] of Object.entries(deals)) {
      if (!d || typeof d !== "object") continue;
      if (d.soldUsd != null) continue; // 売却済みは対象外
      if (d.stoppedAt != null) continue; // 出品停止中は対象外
      targets.push({ key, productId });
      itemCodes.add(productId);
    }
  }
  if (targets.length === 0) {
    console.log("出品中(未売却・未停止)の deal なし。何もしない。");
    return;
  }

  const codes = [...itemCodes].slice(0, MAX_ITEMS);
  if (itemCodes.size > MAX_ITEMS) {
    console.log(`⚠️ 対象itemCode ${itemCodes.size} 件が上限 ${MAX_ITEMS} を超過。今回は${MAX_ITEMS}件まで確認。`);
  }
  console.log(`出品中の楽天死活/在庫チェック開始: deal ${targets.length}件 / itemCode ${codes.length}件 (gap ${RAKUTEN_GAP_MS}ms)`);

  // itemCode ごとに状態を1回だけ判定。本物URL(itemUrl)も取得して deal に焼く（住宅IPワーカー用）。
  const statusByCode = new Map();
  const urlByCode = new Map();
  let alive = 0, dead = 0, soldout = 0, unknown = 0;
  for (const code of codes) {
    const r = await confirmStatus(code);
    statusByCode.set(code, r.status);
    if (r.itemUrl) urlByCode.set(code, r.itemUrl);
    if (r.status === "alive") alive++;
    else if (r.status === "dead") dead++;
    else if (r.status === "soldout") soldout++;
    else unknown++;
    await sleep(RAKUTEN_GAP_MS);
  }

  // 各 deal に反映。
  //  ①本物URL(sourceUrl)のバックフィル：住宅IPワーカーが実ページを叩くのに必須。APIの itemUrl は正しいスラッグURL。
  //  ②弱いフェイルセーフ：APIが明確に dead/soldout を返した時だけフラグ（rareだが無料の保険）。
  //    ⚠️APIの availability=alive は信用しない（売切でも alive を返す）。alive でフラグ解除もしない＝判定の権威は住宅IPワーカー(sourceLivenessWorker)。
  let urled = 0, flagged = 0;
  for (const { key, productId } of targets) {
    const status = statusByCode.get(productId);
    const itemUrl = urlByCode.get(productId) || null;
    const fresh = await kvHget(key, productId);
    if (!fresh || typeof fresh !== "object") continue;
    if (fresh.soldUsd != null || fresh.stoppedAt != null) continue; // 売却/停止されたら触らない
    const next = { ...fresh };
    let changed = false;
    if (itemUrl && fresh.sourceUrl !== itemUrl) { next.sourceUrl = itemUrl; changed = true; urled++; }
    if (status === "dead" || status === "soldout") {
      if (next.sourceStatus !== status) { next.sourceStatus = status; next.sourceCheckedAt = new Date().toISOString(); next.sourceCheckedBy = "api"; changed = true; flagged++; }
    }
    if (changed) await kvHset(key, productId, next);
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `完了: itemCode alive ${alive} / 売り切れ ${soldout} / リンク切れ ${dead} / 不明 ${unknown}。` +
    `本物URL焼き ${urled}件・APIフェイルセーフでフラグ ${flagged}件 (${elapsedSec}s)。実判定は住宅IPワーカー(sourceLivenessWorker.mjs)が担当`
  );
}

main().catch((e) => { console.error("checkListings fatal:", e); process.exit(1); });
