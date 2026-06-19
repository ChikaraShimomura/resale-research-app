#!/usr/bin/env node
// scripts/sourceLivenessWorker.mjs
// 住宅IPワーカー：出品中(ebay_deals)の仕入れ元(楽天)実ページを叩いて、売切(schema.org OutOfStock)/
// 削除(HTTP404)を判定し、deal に sourceStatus を立てる。クラウドの reconcile/auto-stop がそれを見て eBay を止める。
//
// 【なぜ住宅IPでしか動かないか】
//   楽天の商品実ページは GitHub Actions(Azure)等のデータセンターIPからは 200+空ページ(約42byte) にソフトブロックされ、
//   schema.org も HTTPステータスも本物が取れない(②のAzure実測で確定)。住宅IP(このPC/将来ラズパイ)なら本物の114KB前後が取れる。
//   一方 楽天 Item Search API の availability は当てにならない(売切でも alive を返す/最大24hキャッシュ)。
//   ＝「実ページ＝唯一の権威」。これを読めるのは住宅IPだけ。
//
// 【安全則】(誤って生きてる出品を止めない=最重要)
//   ・不明(タイムアウト/429/503/5xx/空ページ/metaなし)は現状維持＝絶対に止めない(fail-open)。
//   ・soldout/dead は1回だけ再確認してから確定。
//   ・大量フラグ(取得異常を疑う割合)になったら丸ごと破棄(systemic false-positive ブレーキ)。
//   ・リダイレクト先ドメインで死活を推定しない：楽天ブックス品は item.rakuten.co.jp/book/… が
//     books.rakuten.co.jp へ正規リダイレクト(在庫あり)するため。死活(削除/リンク切れ)の主担当は checkLinks。
//     ここは「売切(OutOfStock)」を主に、明確な HTTP404 のみ dead 扱い。
//   ・realRakutenUrl/価格レンジ判定の考え方は ①(動画セッション)の refresh.mjs reconcile を踏襲。
//
// env: KV_REST_API_URL / KV_REST_API_TOKEN（.env.local から自動読込）

import fs from "node:fs";

// ---- .env.local 読み込み（scripts/ から見て ../.env.local）----
try {
  const envPath = new URL("../.env.local", import.meta.url);
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI等で .env.local 無しでも env から拾えるので無視 */ }

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const H = { Authorization: `Bearer ${KV_TOKEN}` };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const GAP_MS = Number(process.env.LIVENESS_GAP_MS ?? 800);     // 楽天への礼儀（バースト遮断を避ける）
const CONC = Number(process.env.LIVENESS_CONC ?? 2);
const RECONFIRM_WAIT_MS = 1500;
const BRAKE_MIN_TOTAL = Number(process.env.LIVENESS_BRAKE_MIN ?? 5); // これ未満ではブレーキ判定しない(少数ユーザー保護で低め・env上書き可)
const BRAKE_FLAG_RATIO = 0.7;    // soldout+dead がこの割合超＝取得異常を疑い丸ごと破棄
const MAX_ITEMS = Number(process.env.LIVENESS_MAX ?? 800);
const DRY = process.env.LIVENESS_DRY !== "0"; // 安全側: 明示的に "0" の時だけ本番書込。未設定/その他はDRY(書込なし=eBay停止なし)。本番タスクは liveness-oneshot.cmd が =0 を明示。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ========== Upstash KV（生REST） ==========
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
// 実行ステータスをKVに残す（PC側 livenessStatus.mjs で死活・結果を確認できるように）。
// liveness_status=最新1件 / liveness_log=直近50件のリング。DRYでも書く（テストも見えるように）。
async function writeStatus(report) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["SET", "liveness_status", JSON.stringify(report), "EX", String(90 * 24 * 3600)],
        ["LPUSH", "liveness_log", JSON.stringify(report)],
        ["LTRIM", "liveness_log", "0", "49"],
        ["EXPIRE", "liveness_log", String(60 * 24 * 3600)],
      ]),
    });
  } catch (e) { console.error("writeStatus error:", e.message); }
}
const nowIso = () => new Date().toISOString();
// 実検査が成立した時刻(ok時のみ)。死活監視はこちらの鮮度を見る＝楽天が継続ブロック(429連発)で実質ゼロ件でも
// liveness_status.at だけ新鮮になり「正常」と誤判定される偽陰性を防ぐ。
async function writeRealRun(report) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", "liveness_last_real_run", JSON.stringify(report), "EX", String(90 * 24 * 3600)]]),
    });
  } catch (e) { console.error("writeRealRun error:", e.message); }
}

// ========== 本物URL抽出（①の refresh.mjs realRakutenUrl を踏襲）==========
function realRakutenUrl(srcUrl) {
  if (!srcUrl) return null;
  const s = String(srcUrl);
  // 楽天アフィリ中継(hb.afl.rakuten.co.jp)のときだけ ?pc=<直URL> を取り出す（ホストガードで誤抽出防止）
  if (/hb\.afl\.rakuten\.co\.jp/.test(s)) {
    const m = s.match(/[?&]pc=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]).split("?")[0]; } catch { return m[1]; } }
  }
  if (s.includes("item.rakuten.co.jp")) return s.split("?")[0]; // 直リンク
  return null; // 番号URL(/{shop}/{itemCode番号}/)は組み立てない(404になる)
}

// ========== 実ページ判定 ==========
// 返り値: "soldout" | "dead" | "alive" | "unknown" | "blocked"
async function probeOnce(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8", Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 || res.status === 503) return "blocked";   // レート制限/一時拒否＝以降打ち切り
    if (res.status === 404) return "dead";                            // 明確な404のみ削除扱い(リダイレクトはdeadにしない)
    if (!res.ok) return "unknown";                                    // その他4xx/5xx＝fail-open(現状維持)
    const html = await res.text();
    if (html.length < 2000) return "unknown";                        // 空/極小＝取得異常(DCブロック等)＝fail-open
    // 自動停止の根拠は schema.org microdata の availability のみ（ASCIIなのでページ文字コード非依存・高信頼）。
    const av = html.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)["']/i)?.[1] || "";
    if (/OutOfStock|SoldOut|Discontinued/i.test(av)) return "soldout"; // meta明示の売切のみ自動停止(実測:bababa等)
    if (/InStock|LimitedAvailability|PreOrder|BackOrder|PreSale/i.test(av)) return "alive";
    // metaが無い頁(楽天ファッションのJS描画/楽天books等)は静的HTMLから在庫判定不可→unknown(fail-open＝止めない)。
    // ⚠️本文の「完売/売り切れ」テキストでは判定しない：商品名「完売カラー…」・説明「幾度となく完売を繰り返し」・
    //   予約品・レビュー等で在庫あり品にも頻出し、販売中商品を誤停止する(実測FP)。万能テキスト規則は不可能で、
    //   これがHARUが店ごとに手動「在庫ワード」を要求する理由。テキスト売切は将来 per-URL 設定が要るなら別途。
    return "unknown";
  } catch { return "unknown"; }                                       // timeout等＝fail-open
}

// soldout/dead は1回だけ再確認してから確定（transient対策）
async function probeConfirmed(url) {
  const first = await probeOnce(url);
  if (first === "alive" || first === "unknown" || first === "blocked") return first;
  await sleep(RECONFIRM_WAIT_MS);
  const second = await probeOnce(url);
  // 2回目が alive/unknown に転んだら確定しない(現状維持側に倒す)
  if (second === "soldout" || second === "dead") return second;
  return "unknown";
}

// ========== メイン ==========
async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定。中止。(.env.local を確認)"); process.exit(1); }
  const startedAt = Date.now();

  // 対象を itemCode(productId) 単位に集約。出品中(ebay_deals)＋利益商品カタログ(profitable_products)の両方を見る。
  //  ・出品中 … 売切/削除なら eBay 出品を自動停止(sourceStatus を deal に立てる)
  //  ・カタログ … 出品してなくても売切/削除なら一覧から隠す(catalog_source_status に立てる)←今回の追加
  const byCode = new Map(); // code -> { url, dealLocations:[{key,field}], inCatalog:bool }
  const ensure = (code) => {
    let e = byCode.get(code);
    if (!e) { e = { url: null, dealLocations: [], inCatalog: false }; byCode.set(code, e); }
    return e;
  };

  // 出品中(未売却・未停止)の deal を収集（その itemCode を持つ全 deal の置き場所と本物URL）
  const dealKeys = await kvScan("ebay_deals:*");
  for (const key of dealKeys) {
    const deals = await kvHgetallParsed(key);
    for (const [productId, d] of Object.entries(deals)) {
      if (!d || typeof d !== "object") continue;
      if (d.soldUsd != null || d.stoppedAt != null) continue; // 売却済/停止済は対象外
      const e = ensure(productId);
      e.dealLocations.push({ key, field: productId });
      // 本物URL：deal.sourceUrl(checkListingsがAPIで焼いた値)を最優先。無ければ後でカタログから補完。
      if (!e.url && d.sourceUrl) e.url = realRakutenUrl(d.sourceUrl) || d.sourceUrl;
    }
  }

  // 利益商品カタログ … 全件を対象に（売切なら一覧から隠す）。URLは source.url から本物URLを作る。
  const catalog = await kvGet("profitable_products");
  if (Array.isArray(catalog)) {
    for (const it of catalog) {
      const code = it?.id;
      if (!code) continue;
      const e = ensure(code);
      e.inCatalog = true;
      if (!e.url) e.url = realRakutenUrl(it?.source?.url);
    }
  }

  if (byCode.size === 0) { console.log("対象なし(出品中 deal も利益商品カタログも空)。終了。"); await writeStatus({ at: nowIso(), dry: DRY, note: "idle", total: 0 }); return; }

  const codes = [...byCode.keys()].slice(0, MAX_ITEMS);
  const work = codes.filter((c) => byCode.get(c).url);
  const noUrl = codes.length - work.length;
  console.log(`住宅IP実ページ照合: 対象 ${byCode.size}件(出品中＋利益商品) / URL取得済 ${work.length}件 / URL未取得 ${noUrl}件`);

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

  if (blocked) { console.log("⚠️ 楽天が429/503を返したため打ち切り（fail-open＝何も止めない/隠さない）。"); await writeStatus({ at: nowIso(), dry: DRY, note: "blocked", total: work.length }); return; }

  // 判定タリー（metaが実際に読めてるか＝生存と不明の切り分け確認）
  const tally = { soldout: 0, dead: 0, alive: 0, unknown: 0 };
  for (const c of work) tally[verdicts.get(c) || "unknown"]++;
  console.log(`判定内訳: 生存(InStock) ${tally.alive} / 売切 ${tally.soldout} / 削除 ${tally.dead} / 不明(fail-open) ${tally.unknown}`);

  // systemic false-positive ブレーキ：取得異常で大量フラグなら丸ごと破棄
  const decided = [...verdicts.values()];
  const flagCount = decided.filter((v) => v === "soldout" || v === "dead").length;
  if (decided.length >= BRAKE_MIN_TOTAL && flagCount / decided.length > BRAKE_FLAG_RATIO) {
    console.log(`⚠️ フラグ過多(${flagCount}/${decided.length})＝取得異常を疑い結果を破棄(fail-open)。何も止めない/隠さない。`);
    await writeStatus({ at: nowIso(), dry: DRY, note: "brake", total: decided.length, alive: tally.alive, soldout: tally.soldout, dead: tally.dead, unknown: tally.unknown });
    return;
  }

  // 判定の内訳を表示（soldout/dead は必ず見せる）
  for (const code of work) {
    const v = verdicts.get(code);
    if (v === "soldout" || v === "dead") console.log(`  ${v === "soldout" ? "🟥売切" : "⬛削除"}: ${code}  ${byCode.get(code).url}`);
  }

  // KVへ反映。soldout/dead はフラグを立てる。alive は(実ページ権威なので)既存フラグを解除。unknownは現状維持。
  // DRY=1 のときは書かずに件数だけ出す。
  let setSold = 0, setDead = 0, cleared = 0, catSet = 0, catCleared = 0;
  for (const code of work) {
    const v = verdicts.get(code);
    if (v === "unknown") continue;
    const e = byCode.get(code);

    // (1) 出品中deal の sourceStatus（従来どおり＝eBay自動停止のトリガ）
    for (const { key, field } of e.dealLocations) {
      const fresh = await kvHget(key, field);
      if (!fresh || typeof fresh !== "object") continue;
      if (fresh.soldUsd != null || fresh.stoppedAt != null) continue; // この間に売却/停止されたら触らない
      const cur = fresh.sourceStatus ?? null;
      if (v === "soldout" || v === "dead") {
        if (cur === v) continue;
        if (!DRY) await kvHset(key, field, { ...fresh, sourceStatus: v, sourceCheckedAt: new Date().toISOString(), sourceCheckedBy: "page" });
        if (v === "soldout") setSold++; else setDead++;
      } else if (v === "alive") {
        if (cur == null) continue;
        if (!DRY) {
          const next = { ...fresh, sourceCheckedAt: new Date().toISOString(), sourceCheckedBy: "page" };
          delete next.sourceStatus; // 実ページが在庫ありと言うならフラグ解除
          await kvHset(key, field, next);
        }
        cleared++;
      }
    }

    // (2) カタログの売切/削除フラグ（catalog_source_status ハッシュ）。/api/products が読んで一覧から隠す。
    if (e.inCatalog) {
      if (v === "soldout" || v === "dead") {
        if (!DRY) await kvHset("catalog_source_status", code, { status: v, at: new Date().toISOString() });
        catSet++;
      } else if (v === "alive") {
        if (!DRY) await kvHdel("catalog_source_status", code); // 在庫復活したら解除＝一覧へ戻す
        catCleared++;
      }
    }
  }

  const sec = Math.round((Date.now() - startedAt) / 1000);
  await writeStatus({
    at: nowIso(), dry: DRY, note: "ok", durationSec: sec, total: work.length,
    alive: tally.alive, soldout: tally.soldout, dead: tally.dead, unknown: tally.unknown,
    catalogHidden: catSet, catalogRestored: catCleared,
    dealsSold: setSold, dealsDead: setDead, dealsCleared: cleared,
  });
  // 実検査が成立した(ok)＝この時刻を監視の鮮度基準にする。
  await writeRealRun({ at: nowIso(), alive: tally.alive, soldout: tally.soldout, dead: tally.dead });
  console.log(`${DRY ? "[DRY] " : ""}完了: [出品中] 売切 ${setSold}/削除 ${setDead}/復活解除 ${cleared}  [カタログ] 隠す ${catSet}/戻す ${catCleared}  (URL未取得 ${noUrl}・${sec}s)`);
  console.log(DRY ? "→ DRYなのでKV未書込。本番は LIVENESS_DRY=0 で実行。" : "→ 出品中はreconcile/auto-stopがeBay停止、カタログは/api/productsが一覧から非表示。");
}

main().catch((e) => { console.error("sourceLivenessWorker fatal:", e); process.exit(1); });
