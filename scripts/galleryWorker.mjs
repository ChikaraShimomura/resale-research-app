#!/usr/bin/env node
// scripts/galleryWorker.mjs — 自宅の常時起動機(住宅IP)で回す常駐ワーカー【ローカル/Pi専用・未push】。
//
// 役割: 利益商品カタログ(profitable_products)を巡回し、まだ取得していない商品だけ楽天商品ページから
//       ギャラリー画像URLを取得して KV(ref_gallery:{商品ID}) に保存する。アプリはこれを読んで撮影の
//       「参考写真」として表示する。クラウド(Vercel/GitHub=データセンターIP)は楽天に弾かれるため取得はここが担う。
//
// 重要: これはカタログ全商品の系統的巡回。楽天ToSのグレー度・自宅IPのレート制限リスクが上がるので、
//       低速(PRODUCT_GAP_MS)＋1サイクル上限(CAP_PER_CYCLE)で抑制。撮影参考用のみ・eBay転載NG・公開リポにpushしない。
// env: KV_REST_API_URL, KV_REST_API_TOKEN, [CYCLE_MS=600000], [PRODUCT_GAP_MS=6000], [CAP_PER_CYCLE=30], [REF_TTL_DAYS=30]
import { existsSync, readFileSync } from "fs";

// .env.local / .env があれば読み込む(依存なし)。`vercel env pull .env.local --environment=production` の後はこれで自動的にKV認証が入る。
for (const envFile of [".env.local", ".env"]) {
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CYCLE_MS = Number(process.env.CYCLE_MS ?? 600000);      // 巡回間隔(既定10分)
const PRODUCT_GAP_MS = Number(process.env.PRODUCT_GAP_MS ?? 6000); // 1商品ごとの間隔(低速)
const CAP_PER_CYCLE = Number(process.env.CAP_PER_CYCLE ?? 30); // 1サイクルで取得する新商品の上限
const REF_TTL = Number(process.env.REF_TTL_DAYS ?? 30) * 24 * 3600;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KVH = { Authorization: `Bearer ${KV_TOKEN}` };
if (!KV_URL || !KV_TOKEN) { console.error("KV_REST_API_URL / KV_REST_API_TOKEN 未設定。中止。"); process.exit(1); }

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: KVH });
    const d = await res.json();
    if (d.result == null) return null;
    try { return JSON.parse(d.result); } catch { return d.result; }
  } catch { return null; }
}
async function kvExists(key) {
  try {
    const res = await fetch(`${KV_URL}/exists/${encodeURIComponent(key)}`, { headers: KVH });
    const d = await res.json();
    return Number(d.result) === 1;
  } catch { return false; }
}
async function kvSetEx(key, value, ttl) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...KVH, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", key, JSON.stringify(value), "EX", String(ttl)]]),
    });
  } catch (e) { console.error("kvSetEx error:", e.message); }
}

// アフィリURL(hb.afl/hgc/...?pc=<直URL>)なら直URLを取り出す。直の item.rakuten.co.jp はそのまま。
function toItemUrl(u) {
  if (!u) return "";
  if (/hb\.afl\.rakuten\.co\.jp/.test(u)) {
    const m = u.match(/[?&]pc=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  }
  return u;
}

async function extractGallery(rawUrl) {
  const url = toItemUrl(rawUrl);
  const parts = url.replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/");
  if (!/item\.rakuten\.co\.jp/.test(url)) throw new Error("楽天商品URLでない: " + url);
  const shop = (parts[1] || "").toLowerCase();
  const code = (parts[2] || "").toLowerCase();
  if (!shop || !code) throw new Error("shop/code取得不可: " + url);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja-JP,ja;q=0.9" }, signal: AbortSignal.timeout(25000) });
  const html = await res.text();
  if (res.status !== 200 || html.length < 5000) throw new Error("取得失敗/ブロック status=" + res.status + " len=" + html.length);
  const re = /https?:\/\/(?:thumbnail\.image\.rakuten\.co\.jp\/@0_mall\/|image\.rakuten\.co\.jp\/|tshop\.r10s\.jp\/|shop\.r10s\.jp\/)[^\s"'<>\)]+?\.(?:jpe?g|png|gif)/gi;
  const needle = shop + "/cabinet/";
  const seen = new Map();
  for (const u of html.match(re) || []) {
    const i = u.toLowerCase().indexOf(needle);
    if (i < 0) continue;
    const path = u.slice(i).replace(/\?.*$/, "");
    if (!seen.has(path.toLowerCase())) seen.set(path.toLowerCase(), "https://image.rakuten.co.jp/" + path);
  }
  const urls = [...seen.values()];
  // 商品コード(itemCode)を含む画像＝この商品の正規画像だけ採用する。
  // ⚠️旧実装は code 一致<2枚のとき「ページ内の全jpg」を無差別採用し、関連他商品(おすすめ等)のサムネ＝別商品の
  //    画像を混入させていた(ユーザー指摘:全然関係ない画像)。無差別フォールバックは廃止＝足りなければ少数のまま。
  //    (出品側は楽天API代表画像 productImages で補完するので画像ゼロにはならない＝fail-safe)
  const gallery = urls.filter((u) => u.toLowerCase().includes(code));
  // 並び順スコア。.mjsの文字列内では \d/\. が d/任意1文字に化けるため二重エスケープして正しい正規表現にする。
  const score = (u) => { const f = u.toLowerCase(); if (f.includes(code + "_a1")) return -2; if (f.endsWith("/" + code + ".jpg")) return -1; const n = f.match(new RegExp(code + "_(\\d+)\\."))?.[1]; return n ? Number(n) : 500; };
  return gallery.sort((a, b) => score(a) - score(b)).slice(0, 24);
}

async function cycle() {
  const products = await kvGet("profitable_products");
  if (!Array.isArray(products) || !products.length) { console.log("カタログ空/取得失敗。スキップ。"); return; }
  // 実際に掲載される品(soldVerified)のギャラリーを優先取得＝CAPを「表示される商品」に使う。
  // 落札発掘で非表示の旧品が大量に混ざるため、これが無いと表示品にギャラリーが行き渡らない。
  products.sort((a, b) => (b?.soldVerified ? 1 : 0) - (a?.soldVerified ? 1 : 0));
  let done = 0, empty = 0, err = 0, skip = 0;
  for (const p of products) {
    if (done + empty + err >= CAP_PER_CYCLE) { console.log(`サイクル上限 ${CAP_PER_CYCLE} に到達(次サイクルで続き)。`); break; }
    const id = p?.id;
    const url = p?.source?.url;
    if (!id || !url) continue;
    if (await kvExists(`ref_gallery:${id}`)) { skip++; continue; } // 取得済み=再取得しない
    try {
      const urls = await extractGallery(url);
      const at = new Date().toISOString();
      if (urls.length) {
        await kvSetEx(`ref_gallery:${id}`, { status: "done", urls, at }, REF_TTL);
        done++; console.log(`OK  ${id} → ${urls.length}枚`);
      } else {
        await kvSetEx(`ref_gallery:${id}`, { status: "empty", urls: [], at }, 24 * 3600); // 空は1日TTLで翌日再抽出(errorと同方針・取りこぼし救済)
        empty++; console.log(`空  ${id}`);
      }
    } catch (e) {
      await kvSetEx(`ref_gallery:${id}`, { status: "error", error: e.message, at: new Date().toISOString() }, 24 * 3600); // 1日後に再試行
      err++; console.log(`ERR ${id}: ${e.message}`);
    }
    await sleep(PRODUCT_GAP_MS);
  }
  console.log(`サイクル完了: 取得${done} / 空${empty} / 失敗${err} / 既取得スキップ${skip} (カタログ${products.length})`);
  // 心拍: PC/クラウドから「ギャラリーワーカーが実際に回ったか」を監視できるようKVへ記録(取得対象ゼロでも更新される)。
  await kvSetEx("gallery_last_run", { at: new Date().toISOString(), fetched: done, empty, err, skip, total: products.length }, 90 * 24 * 3600);
}

async function loop() {
  console.log(`galleryWorker(巡回型) 起動: ${CYCLE_MS / 60000}分間隔・1サイクル最大${CAP_PER_CYCLE}件・商品間${PRODUCT_GAP_MS}ms`);
  for (;;) { try { await cycle(); } catch (e) { console.error("cycle error:", e.message); } await sleep(CYCLE_MS); }
}

// ONESHOT=1 のときは1サイクルだけ実行して終了(テスト用)。通常(Pi常駐)は無限ループ。
if (process.env.ONESHOT === "1") {
  cycle().then(() => process.exit(0)).catch((e) => { console.error("cycle fatal:", e); process.exit(1); });
} else {
  loop().catch((e) => { console.error("worker fatal:", e); process.exit(1); });
}
