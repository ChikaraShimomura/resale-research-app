#!/usr/bin/env node
// scripts/used/hardoffLivenessWorker.mjs
// ハードオフ(有在庫モデル)の「カタログ売切隠し」専用ワーカー。
//
// 【最重要の前提：ハードオフは"有在庫"＝楽天(無在庫)と真逆】
//   ユーザーは中古1点物を「自分で先に買って(=仕入れた)手元に持ってから」eBayに出品する。
//   ＝ハードオフ上でその品が売切になるのは「ユーザー自身が買ったから」が普通。だから:
//     ✗ 出品中(ebay_deals)を売切で自動停止してはいけない（手元に在庫がある＝出品は正当）。
//     ✗ 出品(publish)を売切でブロックしてはいけない（買った品を出すのだから売切は当然）。
//   このワーカーがやるのは1つだけ:
//     ✓ 利益カタログ(used_catalog)の中で、もう買えない(売切/掲載終了)品を一覧から隠す。
//       ＝他のユーザーが「まだ買える利益商品」として誤って仕入れに行くのを防ぐ(出品判断の手前)。
//
//   ⚠️初版(2026-06-28)は楽天の無在庫ロジックをそのまま移植し、ユーザーが仕入れた/出品中の品まで
//     売切検知で eBay 自動停止してしまった(オーナー指摘・実害11件)。deal停止と publishガードを撤去し、
//     「カタログ隠しのみ」に修正した。楽天版の deal.sourceStatus→reconcile 経路はハードオフには使わない。
//
// シグナル: 実ページの schema.org/JSON-LD "availability"(OutOfStock/SoldOut/Discontinued→売切)＋HTTP404/410→掲載終了。
//   ハードオフは Vercel(DC-IP)でも取れる(Akamai無し)が、保守的に Pixel(termux-run.sh)で回す。実測で不明=0(全頁availability取得可)。
// 安全則: 不明は fail-open(隠さない)/売切・掲載終了は1回再確認/フラグ過多はブレーキ/既定DRY(本番は HARDOFF_LIVENESS_DRY=0)。
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN（.env.local 自動読込）
import fs from "node:fs";

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
const GAP_MS = Number(process.env.HARDOFF_LIVENESS_GAP_MS ?? 1200);   // ハードオフへの礼儀（低頻度厳守）
const CONC = Number(process.env.HARDOFF_LIVENESS_CONC ?? 2);
const RECONFIRM_WAIT_MS = 1500;
const BRAKE_MIN_TOTAL = Number(process.env.HARDOFF_LIVENESS_BRAKE_MIN ?? 5); // これ未満ではブレーキ判定しない
const BRAKE_FLAG_RATIO = 0.7;        // 売切+掲載終了がこの割合超＝取得異常を疑い丸ごと破棄
const MAX_ITEMS = Number(process.env.HARDOFF_LIVENESS_MAX ?? 300); // カタログ実数(~150)に十分。低頻度厳守。env上書き可
const DRY = process.env.HARDOFF_LIVENESS_DRY !== "0"; // 安全側：明示的に "0" の時だけ本番書込。
const DEBUG = process.env.HARDOFF_LIVENESS_DEBUG === "1";
// 実ページ検証後に売切テキストを足せる任意の追加規則（既定OFF＝空）。誤検知防止のため厳密な語のみ設定すること。
const SOLD_REGEX = (() => {
  const s = process.env.HARDOFF_SOLD_REGEX || "";
  if (!s) return null;
  try { return new RegExp(s, "i"); } catch { return null; }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ========== Upstash KV（生REST） ==========
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H });
    const r = (await res.json()).result;
    if (r == null) return null;
    try { return JSON.parse(r); } catch { return r; }
  } catch { return null; }
}
async function kvSet(key, value, exSec) {
  try {
    const cmd = exSec ? ["SET", key, String(value), "EX", String(exSec)] : ["SET", key, String(value)];
    await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify([cmd]) });
    return true;
  } catch (e) { console.error("kvSet error:", e.message); return false; }
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
async function kvHset(key, field, value) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([["HSET", key, field, JSON.stringify(value)]]),
    });
    return true;
  } catch (e) { console.error("kvHset error:", e.message); return false; }
}
async function kvHdel(key, field) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([["HDEL", key, field]]),
    });
    return true;
  } catch (e) { console.error("kvHdel error:", e.message); return false; }
}

// ハードオフの直URLか判定（netmall.hardoff.co.jp の商品ページ）。
const hardoffUrlOf = (s) => (s && String(s).includes(HARDOFF_HOST) ? String(s).split("?")[0] : null);

// DEBUG：availability と「売切らしき語」を出して、Pixelで実物を見て主シグナルを確かめられるようにする。
function debugDump(url, html, av) {
  const markers = ["売り切れ", "売切", "SOLD OUT", "soldout", "ご注文を承", "ご注文いただけ", "在庫切れ", "完売", "販売を終了", "販売終了"];
  const hits = markers.filter((m) => html.includes(m));
  console.log(`  [debug] ${url}\n    availability="${av}" len=${html.length} markers=${hits.join("|") || "なし"}`);
}

// ========== 実ページ判定 ==========
// 返り値: "soldout" | "dead" | "alive" | "unknown" | "blocked"
async function probeOnce(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8", Accept: "text/html" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429 || res.status === 503) return "blocked"; // レート制限/一時拒否＝以降打ち切り
    if (res.status === 404 || res.status === 410) return "dead";    // 掲載終了/削除
    if (!res.ok) return "unknown";                                  // その他4xx/5xx＝fail-open
    const html = await res.text();
    if (html.length < 2000) return "unknown";                      // 空/極小＝取得異常＝fail-open
    const av =
      html.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/["']availability["']\s*:\s*["']([^"']+)["']/i)?.[1] || "";
    if (DEBUG) debugDump(url, html, av);
    if (/OutOfStock|SoldOut|Discontinued/i.test(av)) return "soldout";
    if (/InStock|LimitedAvailability|PreOrder|BackOrder|PreSale/i.test(av)) return "alive";
    if (SOLD_REGEX && SOLD_REGEX.test(html)) return "soldout";
    return "unknown"; // availabilityが読めない頁＝fail-open(隠さない)
  } catch { return "unknown"; }                                    // timeout等＝fail-open
}

// 売切/掲載終了は1回だけ再確認してから確定（transient対策）。
async function probeConfirmed(url) {
  const first = await probeOnce(url);
  if (first === "alive" || first === "unknown" || first === "blocked") return first;
  await sleep(RECONFIRM_WAIT_MS);
  const second = await probeOnce(url);
  if (second === "soldout" || second === "dead") return second;
  return "unknown";
}

// ========== メイン（カタログ売切隠しのみ） ==========
async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定。中止。(.env.local を確認)"); process.exit(1); }
  const startedAt = Date.now();

  const catalog = await kvGet("used_catalog");
  if (!Array.isArray(catalog) || catalog.length === 0) { console.log("used_catalog が空。終了。"); return; }

  // 利益カタログの各品 → ハードオフ実ページURL。★id重複排除（同一商品の二重照合＝hide/show不整合を防ぐ）。
  const seenT = new Set();
  const targets = [];
  for (const it of catalog) {
    const u = hardoffUrlOf(it?.hardoffUrl);
    if (it?.id && u && !seenT.has(it.id)) { seenT.add(it.id); targets.push({ id: it.id, url: u }); }
  }
  // ★ローテーションカーソル(2026-07-08)：MAX_ITEMS で全カタログ(~1120)を一度に照合すると重い＆穴が出る（旧: 先頭300件だけ→残りの売切が隠れない）。
  //   毎サイクル カーソルを進めて次の MAX_ITEMS 件を見る＝数サイクル(毎時)で全件を必ず網羅。カーソルはKVに保存(TTL30日・DRY時は進めない)。
  let cursor = 0;
  try { cursor = Number(await kvGet("hardoff_liveness_cursor")) || 0; } catch { /* noop */ }
  if (!Number.isFinite(cursor) || cursor < 0 || cursor >= targets.length) cursor = 0;
  const work = targets.length <= MAX_ITEMS
    ? targets
    : [...targets.slice(cursor), ...targets.slice(0)].slice(0, MAX_ITEMS); // カーソルから MAX_ITEMS 件（末尾は先頭へ回り込む）
  const nextCursor = targets.length <= MAX_ITEMS ? 0 : (cursor + MAX_ITEMS) % targets.length;
  if (!DRY) { await kvSet("hardoff_liveness_cursor", nextCursor, 30 * 24 * 3600); }
  console.log(`ハードオフ実ページ照合(カタログ売切隠し): カタログ ${catalog.length}件 / 対象 ${targets.length}件 / 今回 ${work.length}件 (cursor ${cursor}→${nextCursor})${DRY ? "  [DRY]" : ""}`);

  // 既存の used_source_status を1回読む＝在庫復活時に「フラグがある品だけ」HDEL（無駄打ち回避）。
  const existing = await kvHgetallParsed("used_source_status");

  // 並列判定
  const verdicts = new Map(); // id -> verdict
  let idx = 0, blocked = false;
  async function runner() {
    while (idx < work.length) {
      const t = work[idx++];
      if (blocked) { verdicts.set(t.id, "unknown"); continue; }
      const v = await probeConfirmed(t.url);
      if (v === "blocked") { blocked = true; verdicts.set(t.id, "unknown"); continue; }
      verdicts.set(t.id, v);
      await sleep(GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONC }, runner));

  if (blocked) { console.log("⚠️ ハードオフが429/503を返したため打ち切り（fail-open＝何も隠さない/戻さない）。"); return; }

  const tally = { soldout: 0, dead: 0, alive: 0, unknown: 0 };
  for (const t of work) tally[verdicts.get(t.id) || "unknown"]++;
  console.log(`判定内訳: 生存(InStock) ${tally.alive} / 売切 ${tally.soldout} / 掲載終了 ${tally.dead} / 不明(fail-open) ${tally.unknown}`);

  // systemic false-positive ブレーキ：取得異常で大量フラグなら丸ごと破棄。
  const decided = [...verdicts.values()];
  const flagCount = decided.filter((v) => v === "soldout" || v === "dead").length;
  if (decided.length >= BRAKE_MIN_TOTAL && flagCount / decided.length > BRAKE_FLAG_RATIO) {
    console.log(`⚠️ フラグ過多(${flagCount}/${decided.length})＝取得異常を疑い破棄(fail-open)。何も隠さない/戻さない。`);
    return;
  }

  // KVへ反映＝カタログ隠しフラグ(used_source_status)のみ。出品中deal/eBayには一切触れない。
  let hidden = 0, restored = 0;
  for (const t of work) {
    const v = verdicts.get(t.id);
    if (v === "soldout" || v === "dead") {
      if (!DRY) await kvHset("used_source_status", t.id, { status: v, at: nowIso() });
      hidden++;
    } else if (v === "alive") {
      if (existing && existing[t.id]) { // フラグがある品だけ解除（在庫復活＝一覧へ戻す）
        if (!DRY) await kvHdel("used_source_status", t.id);
        restored++;
      }
    }
    // unknown=現状維持
  }

  const sec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`${DRY ? "[DRY] " : ""}完了: カタログ非表示 ${hidden}件 / 在庫復活で戻す ${restored}件 (${sec}s)`);
  console.log(DRY ? "→ DRYなのでKV未書込。本番は HARDOFF_LIVENESS_DRY=0 で実行。" : "→ getUsedCatalog が used_source_status を読んで一覧から非表示。出品中/仕入れた品には触れない。");
}

main().catch((e) => { console.error("hardoffLivenessWorker fatal:", e); process.exit(1); });
