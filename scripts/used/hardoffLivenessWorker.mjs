#!/usr/bin/env node
// scripts/used/hardoffLivenessWorker.mjs
// 住宅IPワーカー：仕入れ元がハードオフ(netmall.hardoff.co.jp)の実ページを叩いて、
// 売切(schema.org/JSON-LD availability=OutOfStock 等)/削除(HTTP404)を判定する。
//   ・出品中(ebay_deals) … deal.sourceStatus を立てる → クラウドの reconcile/auto-stop が eBay 出品を自動停止。
//   ・利益カタログ(used_catalog) … used_source_status に立てる → getUsedCatalog が一覧から隠す。
// ＝楽天版 sourceLivenessWorker.mjs のハードオフ移植（無在庫の欠品キャンセルを防ぐのが目的）。
//
// 【ハードオフの事情】
//   ・netmall はサーバー描画(Akamaiチャレンジ無し・純fetchで実HTML)。fetchHardoff と同じく取れる。
//     楽天と違い住宅IP必須かは未確証だが、保守的に住宅IP(Pixel/termux-run.sh)で回す。
//   ・中古は1点物＝売れたら復活しない。売切は schema.org availability か 404(掲載終了) で出るのが基本。
//   ・⚠️ハードオフ個別ページの売切表現はPCから検証不可。schema.org/JSON-LD availability + 404 を主シグナルにし、
//     本文テキスト規則は誤検知の温床なので既定OFF。実ページを見て確かめたら HARDOFF_SOLD_REGEX(env) で足せる。
//     HARDOFF_LIVENESS_DEBUG=1 で先頭数件の availability/候補マーカーを出力＝Pixelで実物を見て調整できる。
//
// 【安全則】（楽天版と同一＝生きてる出品を誤って止めないのが最優先）
//   ・不明(timeout/429/5xx/空ページ/シグナル無し)は現状維持＝絶対に止めない(fail-open)。
//   ・soldout/dead は1回だけ再確認してから確定(transient対策)。
//   ・フラグ過多(取得異常の疑い)は丸ごと破棄(systemic false-positive ブレーキ)。
//   ・既定DRY。本番書込は HARDOFF_LIVENESS_DRY=0 を明示した時だけ（termux-run.sh が明示）。
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN（.env.local から自動読込）
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
const BRAKE_FLAG_RATIO = 0.7;        // soldout+dead がこの割合超＝取得異常を疑い丸ごと破棄
const MAX_ITEMS = Number(process.env.HARDOFF_LIVENESS_MAX ?? 300); // カタログ実数(~150)に対し十分。低頻度厳守。env上書き可
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

// ========== Upstash KV（生REST・楽天版と同じ） ==========
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
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H });
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
async function kvHdel(key, field) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([["HDEL", key, field]]),
    });
    return true;
  } catch (e) { console.error("kvHdel error:", e.message); return false; }
}

// ハードオフの直URLか判定（netmall.hardoff.co.jp の商品ページ）。affiliate中継等は無いのでそのまま使う。
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
    // 自動停止の根拠は schema.org の availability（microdata or JSON-LD）。ASCIIなのでページ文字コード非依存・高信頼。
    const av =
      html.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      html.match(/["']availability["']\s*:\s*["']([^"']+)["']/i)?.[1] || "";
    if (DEBUG) debugDump(url, html, av);
    if (/OutOfStock|SoldOut|Discontinued/i.test(av)) return "soldout";
    if (/InStock|LimitedAvailability|PreOrder|BackOrder|PreSale/i.test(av)) return "alive";
    // 任意の追加規則（実ページ検証後に HARDOFF_SOLD_REGEX で厳密語のみ設定した時だけ）。
    if (SOLD_REGEX && SOLD_REGEX.test(html)) return "soldout";
    // availability が読めない頁＝静的HTMLから在庫判定不可→unknown(fail-open＝止めない)。
    // ⚠️本文の「売り切れ/完売」テキストでは判定しない：商品名/説明/レビューに在庫あり品でも頻出するため(楽天版で実測FP)。
    return "unknown";
  } catch { return "unknown"; }                                    // timeout等＝fail-open
}

// soldout/dead は1回だけ再確認してから確定（transient対策）。
async function probeConfirmed(url) {
  const first = await probeOnce(url);
  if (first === "alive" || first === "unknown" || first === "blocked") return first;
  await sleep(RECONFIRM_WAIT_MS);
  const second = await probeOnce(url);
  if (second === "soldout" || second === "dead") return second;
  return "unknown"; // 2回目が alive/unknown に転んだら確定しない(現状維持側)
}

// ========== メイン ==========
async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定。中止。(.env.local を確認)"); process.exit(1); }
  const startedAt = Date.now();

  // 利益カタログ(used_catalog)から id→ハードオフURL を作る（カタログ判定＋deal の URL 補完に使う）。
  const catalog = await kvGet("used_catalog");
  const catUrlById = new Map(); // id -> hardoffUrl
  if (Array.isArray(catalog)) {
    for (const it of catalog) {
      const u = hardoffUrlOf(it?.hardoffUrl);
      if (it?.id && u) catUrlById.set(it.id, u);
    }
  }

  // 対象を productId 単位に集約。
  const byCode = new Map(); // code -> { url, dealLocations:[{key,field}], inCatalog:bool }
  const ensure = (code) => {
    let e = byCode.get(code);
    if (!e) { e = { url: null, dealLocations: [], inCatalog: false }; byCode.set(code, e); }
    return e;
  };

  // (1) 出品中(未売却・未停止)の deal で「仕入れ元がハードオフ」のものを収集。
  //     URLは deal.sourceUrl(publishが焼いたハードオフ直URL)を最優先、無ければ used_catalog から補完。
  const dealKeys = await kvScan("ebay_deals:*");
  for (const key of dealKeys) {
    const deals = await kvHgetallParsed(key);
    for (const [productId, d] of Object.entries(deals)) {
      if (!d || typeof d !== "object") continue;
      if (d.soldUsd != null || d.stoppedAt != null) continue; // 売却済/停止済は対象外
      const url = hardoffUrlOf(d.sourceUrl) || catUrlById.get(productId) || null;
      if (!url) continue; // ハードオフ品でない(楽天等)/URL不明 はこのワーカーの対象外
      const e = ensure(productId);
      e.dealLocations.push({ key, field: productId });
      if (!e.url) e.url = url;
    }
  }

  // (2) 利益カタログ … 出品してなくても売切/削除なら一覧から隠す。
  for (const [id, url] of catUrlById) {
    const e = ensure(id);
    e.inCatalog = true;
    if (!e.url) e.url = url;
  }

  if (byCode.size === 0) { console.log("対象なし(ハードオフの出品中 deal も used_catalog も空)。終了。"); return; }

  const codes = [...byCode.keys()].slice(0, MAX_ITEMS);
  const work = codes.filter((c) => byCode.get(c).url);
  console.log(`ハードオフ実ページ照合: 対象 ${byCode.size}件(出品中＋カタログ) / URL取得済 ${work.length}件${DRY ? "  [DRY]" : ""}`);

  // 並列ワーカーで判定
  const verdicts = new Map(); // code -> verdict
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

  if (blocked) { console.log("⚠️ ハードオフが429/503を返したため打ち切り（fail-open＝何も止めない/隠さない）。"); return; }

  // 判定タリー
  const tally = { soldout: 0, dead: 0, alive: 0, unknown: 0 };
  for (const c of work) tally[verdicts.get(c) || "unknown"]++;
  console.log(`判定内訳: 生存(InStock) ${tally.alive} / 売切 ${tally.soldout} / 削除 ${tally.dead} / 不明(fail-open) ${tally.unknown}`);

  // systemic false-positive ブレーキ：取得異常で大量フラグなら丸ごと破棄。
  const decided = [...verdicts.values()];
  const flagCount = decided.filter((v) => v === "soldout" || v === "dead").length;
  if (decided.length >= BRAKE_MIN_TOTAL && flagCount / decided.length > BRAKE_FLAG_RATIO) {
    console.log(`⚠️ フラグ過多(${flagCount}/${decided.length})＝取得異常を疑い結果を破棄(fail-open)。何も止めない/隠さない。`);
    return;
  }

  for (const code of work) {
    const v = verdicts.get(code);
    if (v === "soldout" || v === "dead") console.log(`  ${v === "soldout" ? "🟥売切" : "⬛削除"}: ${code}  ${byCode.get(code).url}`);
  }

  // KVへ反映。soldout/dead はフラグを立てる。alive は(実ページ権威なので)既存フラグを解除。unknownは現状維持。
  let setSold = 0, setDead = 0, cleared = 0, catSet = 0, catCleared = 0;
  for (const code of work) {
    const v = verdicts.get(code);
    if (v === "unknown") continue;
    const e = byCode.get(code);

    // (1) 出品中deal の sourceStatus（reconcile/auto-stop が eBay 出品を停止）
    for (const { key, field } of e.dealLocations) {
      const fresh = await kvHget(key, field);
      if (!fresh || typeof fresh !== "object") continue;
      if (fresh.soldUsd != null || fresh.stoppedAt != null) continue; // この間に売却/停止されたら触らない
      const cur = fresh.sourceStatus ?? null;
      if (v === "soldout" || v === "dead") {
        if (cur === v) continue;
        if (!DRY) await kvHset(key, field, { ...fresh, sourceStatus: v, sourceCheckedAt: nowIso(), sourceCheckedBy: "hardoff-page" });
        if (v === "soldout") setSold++; else setDead++;
      } else if (v === "alive") {
        if (cur == null) continue;
        if (!DRY) {
          const next = { ...fresh, sourceCheckedAt: nowIso(), sourceCheckedBy: "hardoff-page" };
          delete next.sourceStatus; // 実ページが在庫ありと言うならフラグ解除
          delete next.stopFailedCount;
          delete next.stopFailedAt;
          await kvHset(key, field, next);
        }
        cleared++;
      }
    }

    // (2) カタログの売切/削除フラグ（used_source_status ハッシュ）。getUsedCatalog が読んで一覧から隠す。
    if (e.inCatalog) {
      if (v === "soldout" || v === "dead") {
        if (!DRY) await kvHset("used_source_status", code, { status: v, at: nowIso() });
        catSet++;
      } else if (v === "alive") {
        if (!DRY) await kvHdel("used_source_status", code); // 在庫復活したら解除＝一覧へ戻す
        catCleared++;
      }
    }
  }

  const sec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`${DRY ? "[DRY] " : ""}完了: [出品中] 売切 ${setSold}/削除 ${setDead}/復活解除 ${cleared}  [カタログ] 隠す ${catSet}/戻す ${catCleared}  (${sec}s)`);
  console.log(DRY ? "→ DRYなのでKV未書込。本番は HARDOFF_LIVENESS_DRY=0 で実行。" : "→ 出品中はreconcile/auto-stopがeBay停止、カタログはgetUsedCatalogが一覧から非表示。");
}

main().catch((e) => { console.error("hardoffLivenessWorker fatal:", e); process.exit(1); });
