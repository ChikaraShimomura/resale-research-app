#!/usr/bin/env node
// scripts/ebaySoldWorker.mjs
// eBayの「売却済み(Sold/Completed)」ページをスクレイプし、カタログ各商品の直近落札中央値(JPY)を
// KV `ebay_soldprice:{productId}` に保存する。Marketplace Insights API(承認制)を待たない回避策A。
// ⚠️キー名は `ebay_soldprice:`。別機能の売却検知 `ebay_sold:{actor}`(ユーザーの売れた商品マップ・180日)と
//   名前空間を分けるため。`ebay_sold:` は使わない（商品idとactor idの衝突でユーザーデータ破壊を防ぐ）。
//
// 【Pixel/Termuxで動く】Chromium不要の純node fetch＋ブラウザ並みヘッダ/Cookie。eBayの403は主にIP起因＝
//   住宅IP(Pixel/このPC)で通る見込み。DC IP(GitHub Actions等)は不可。楽天死活ワーカーと同じTermux運用に乗る。
//
// 【UI変更に強くする＝多層ガード（誤データでカタログ相場を汚さない／壊れたら気づく）】
//   1) パース健全性：1商品で価格が取れない＝サンプル不足→書かない（個別スキップ）。
//   2) 値の妥当性：落札中央値が「その商品の現eBay相場(realAvgPrice)」から極端に乖離(×0.2未満/×5超)は
//      パース誤り(送料や別商品を拾った等)とみなし破棄。
//   3) 系統的失敗ブレーキ：1回の実行で 失敗率(ブロック+0件+妥当性NG) が高い＝eBayのUI変更/IPブロックの疑い
//      → その実行の書込を“全部”中止（一部の通った分も書かない＝汚染回避）＋status を unhealthy で記録。
//   4) 監視：`ebay_soldprice_status` に毎回サマリを残す（cron監視→メール通知に使える）。
//   5) 失効：各値は TTL(既定7日)。ワーカーが壊れて止まれば自然失効→消費側は現在出品相場へ自動フォールバック。
//
// 使い方(PowerShell/Termux・リポジトリ直下):
//   EBAY_SOLD_DRY=1 EBAY_SOLD_MAX=5 node scripts/ebaySoldWorker.mjs   # 試運転(書込なし)
//   EBAY_SOLD_DRY=0 node scripts/ebaySoldWorker.mjs                    # 本書込

import fs from "node:fs";
import { EBAY_JP_QUERIES, PROHIBITED_EXCLUDE } from "./ebayQueries.mjs";
import { decodeHtmlEntities } from "../app/lib/htmlEntities.mjs";
try {
  const envPath = new URL("../.env.local", import.meta.url);
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* env から拾えるので無視 */ }

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const H = { Authorization: `Bearer ${KV_TOKEN}` };
const USD_JPY = Number(process.env.LANDED_USD_JPY) || 155;

const DRY = process.env.EBAY_SOLD_DRY !== "0";
const GAP_MS = Number(process.env.EBAY_SOLD_GAP_MS ?? 4000);
const WINDOW_DAYS = Number(process.env.EBAY_SOLD_WINDOW_DAYS ?? 30); // 直近この日数の落札だけ採用（既定30日）
const BRAKE_MIN = Number(process.env.EBAY_SOLD_BRAKE_MIN ?? 5);
const BRAKE_RATIO = Number(process.env.EBAY_SOLD_BRAKE_RATIO ?? 0.6); // 失敗率これ超で全書込中止
const SEED_PER_KW = Number(process.env.EBAY_SOLD_SEED_PER_KW ?? 20); // 発掘：1キーワードあたり拾う"ユニーク落札商品"上限
const SEED_TTL_S = Number(process.env.EBAY_SOLD_SEED_TTL_H ?? 72) * 3600; // ebay_sold_seed のTTL（既定72h＝発掘が止まれば自然失効）
const DISCOVER_KW_MAX = Number(process.env.EBAY_SOLD_DISCOVER_KW_MAX) || 0; // 発掘で回すキーワード数の上限（0=全件。試運転で小さく）
const DISCOVER_PAGES = Math.max(1, Number(process.env.EBAY_SOLD_DISCOVER_PAGES) || 1); // 1キーワードで取得する落札ページ数（_pgn）。種を増やす時に上げる（既定1=Pixel常駐は軽く）
const SEED_MIN_JPY = Number(process.env.EBAY_SOLD_SEED_MIN_JPY ?? 1000); // 発掘：この落札額未満は種にしない（単パック等の安物が枠を食うのを防ぐ。refresh Phase0の下限と一致）
const SEED_MAX_JPY = Number(process.env.EBAY_SOLD_SEED_MAX_JPY ?? 130000); // 発掘：この落札額超は種にしない（$800≒¥124k=serveの申告上限。バルクロット/高額別物を除外）
const LOT_RE = /\blot\s+of\b|\bbundle\b|\bcase\s+of\b|\bx\s?\d{2,}\b|\(\s*\d{2,}\s*(?:packs?|cards?|boxes?)?\s*\)/i; // 複数まとめ売り（単品でない＝楽天単品と価格が合わない）
const SEED_SIM = Number(process.env.EBAY_SOLD_SEED_SIM) || 0.6; // 発掘：落札タイトルがこの類似度以上なら「同一商品」として束ねる(eBayは出品者ごとに表記が違うので完全一致だと実需が1に割れる)
const SEED_MIN_SOLD = Math.max(1, Number(process.env.EBAY_SOLD_SEED_MIN_SOLD) || 1); // 発掘：直近落札がこの件数以上の商品だけ種にする(1=全部 / 2=実需が確かな品だけに絞る)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const jitterGap = () => sleep(Math.round(GAP_MS * rnd(1, 2.2)));

const cookieJar = {};
const cookieHeader = () => Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ") || undefined;
function storeCookies(res) {
  try { for (const c of res.headers.getSetCookie?.() ?? []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) cookieJar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } } catch {}
}
function browserHeaders(referer) {
  const h = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="24"',
    "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none", "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) h.Referer = referer;
  const c = cookieHeader(); if (c) h.Cookie = c;
  return h;
}

async function kvSetJson(key, val, ttl) {
  // 値はURLパスでなく「ボディ」で送る（pipeline形式）。URLパス方式は大きな種(数千件=~MB)でURL長超過で失敗するため。
  try {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", key, JSON.stringify(val), "EX", String(ttl)]]),
    });
    return res.ok;
  } catch { return false; }
}

// 売却済みページ(新SRP)を商品カード単位で解析。eBayは2025年に商品カードを s-item__* → s-card__* へ刷新した。
// 1カード = 1 s-card__caption（落札日「Sold Jun 22, 2026」入り）。これを区切りに、各カードの最初の s-card__price と対にする。
// 価格は閲覧地(日本IP)では「JPY x,xxx」= 既に円表記なので円で直接採用。稀な「$」表記のみ ×usdJpy で円換算。
// 落札日プレースホルダ(先頭の"Shop on eBay"広告)は caption が無いので chunks[0] に入り自然に除外される。
// 返り値: { prices(窓内・JPY), items(カード数=caption数), dated(落札日が取れた数), withWindow(窓内カード数) }。
function ageDays(dateStr) { const t = Date.parse(dateStr); return Number.isNaN(t) ? null : (Date.now() - t) / 86400000; }
// コンディション判定：明確に「中古」のものだけ除外する。"New (Other)"/"New other (see details)" 等の新品系は残す
//   （eBayの厳格な "Brand New" だけに絞ると新品系の出来高を取りこぼし、誤って落札不足になるため）。
const isUsedCond = (s) => /pre-?owned|\bused\b|中古|ジャンク|junk|for parts|not working|seller refurbished/i.test(s);
// タイトル類似度（AI不要・単語の重なり=overlap係数）。落札候補を「カタログ既知の同一品名」に似てる順で選ぶのに使う。
const titleTokens = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 2));
function titleSim(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size); // 小さい方に対する重なり率＝片方が長くても効く
}
export function parseSoldWithin(html, windowDays, usdJpy, wantNew = true) {
  // s-card__image を区切りに1カード=1チャンク（画像→落札日→コンディション→URL→価格が同じチャンクに収まる）。
  // ※カード数(items)は s-card__caption の数で別途数える（s-card__image は1カードに複数出るので区切り用途のみ）。
  const chunks = html.split(/class=s-card__image/);
  const items = (html.match(/s-card__caption/g) || []).length;
  const prices = []; const cards = []; let dated = 0, withWindow = 0, usedSkipped = 0;
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i].slice(0, 4500);
    // 落札日: "Sold Mon DD, YYYY"（"Sold"接頭辞の有無どちらも許容＝将来表記揺れに強く）。
    const dm = c.match(/Sold\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/) || c.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/);
    let age = null; if (dm) { age = ageDays(dm[1]); if (age != null) dated++; }
    if (age == null || age < -1 || age > windowDays) continue; // 窓外/日付不明は採用しない
    withWindow++;
    // コンディション(s-card__subtitle の先頭テキスト)。新品商品(wantNew)では中古カードを除外＝新品同士で比較。
    const cm = c.match(/s-card__subtitle[^>]*>\s*<span[^>]*>([^<]{2,40})/);
    if (wantNew && cm && isUsedCond(cm[1])) { usedSkipped++; continue; }
    // 価格: このカードの最初の s-card__price。JPY=円直値 / $=USD×レート。それ以外の通貨は採らない。
    const pj = c.match(/s-card__price[^>]*>\s*(?:JPY|¥)\s*([0-9][0-9,]*)/);
    const pd = pj ? null : c.match(/s-card__price[^>]*>\s*(?:US\s*)?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
    let jpy = null;
    if (pj) jpy = parseInt(pj[1].replace(/,/g, ""), 10);
    else if (pd) jpy = Math.round(parseFloat(pd[1].replace(/,/g, "")) * usdJpy);
    if (!(jpy > 0)) continue;
    prices.push(jpy);
    // 候補（AI同一判定の材料）：高解像度画像(data-defer-load=s-l500)優先・タイトルはimg alt・実物URL。
    const im = c.match(/data-defer-load=(https:\/\/i\.ebayimg\.com\/[^"'\s>]+)/) || c.match(/src=(https:\/\/i\.ebayimg\.com\/[^"'\s>]+)/);
    const um = c.match(/https:\/\/www\.ebay\.com\/itm\/(\d+)/);
    const al = c.match(/alt="([^"]{3,140})"/);
    if (im && um) cards.push({ price: jpy, ageDays: Math.round(age), url: `https://www.ebay.com/itm/${um[1]}`, img: im[1], title: al ? decodeHtmlEntities(al[1].trim()) : "", cond: cm ? cm[1].trim() : "" });
  }
  cards.sort((a, b) => a.ageDays - b.ageDays); // 直近(落札が新しい)順＝検証は先頭から
  return { prices, items, dated, withWindow, usedSkipped, cards };
}
export async function get(url, referer) {
  const res = await fetch(url, { headers: browserHeaders(referer), redirect: "follow", signal: AbortSignal.timeout(20000) });
  storeCookies(res); return { status: res.status, html: await res.text() };
}
const isBlocked = (html) => /Pardon Our Interruption|Checking your browser|verify you are a human|to continue, please|captcha/i.test(html.slice(0, 4000));

// ★発掘モード：EBAY_JP_QUERIES のキーワード別に「売れた出品(Sold)」をスクレイプし、楽天マッチ用の種を KV ebay_sold_seed に格納。
//   各 seed = {title, priceJpy(=同一商品の落札中央値), category, imageUrl, itemUrl(代表=直近落札), rank, soldCount, soldWindowDays}。
//   refresh.mjs(GitHub)がこの種を読み、楽天×画像AIでマッチ→「生まれた時点で落札確定(soldVerified)」の利益商品を作る。
//   ＝「現在出品」ではなく「実際に売れた出品」起点で発掘する（ユーザー指摘2026-06-23）。
async function discoverSeeds() {
  console.log(`★発掘モード(discover): ${(DISCOVER_KW_MAX>0?DISCOVER_KW_MAX:EBAY_JP_QUERIES.length)}キーワード × 最大${SEED_PER_KW}件/語 × ${DISCOVER_PAGES}ページ → ebay_sold_seed (窓${WINDOW_DAYS}日)`);
  try { const w = await get("https://www.ebay.com", null); if (isBlocked(w.html)) console.log("  ⚠️ トップで検問。住宅IPでない可能性"); await sleep(Math.round(rnd(1200, 2500))); } catch {}

  // 時計だけに絞った運用では、発掘も時計キーワードのみにして eBay 負荷を1/10に下げる（IP枯渇→refineが検問になるのを防ぐ）。
  const WATCH_KW = /セイコー|シチズン|カシオ|Gショック|G-?SHOCK|オリエント|オシアナス|アテッサ|プロマスター|エディフィス|プロトレック|ロイヤルAE|F91W|腕時計|ウォッチ|watch/i;
  let queries = EBAY_JP_QUERIES;
  if (process.env.EBAY_WATCH_ONLY === "1") queries = queries.filter((x) => WATCH_KW.test(x.name) || WATCH_KW.test(x.q));
  if (DISCOVER_KW_MAX > 0) queries = queries.slice(0, DISCOVER_KW_MAX);
  console.log(`  実行キーワード数: ${queries.length}${process.env.EBAY_WATCH_ONLY === "1" ? "（時計のみ）" : ""}`);
  const seeds = [];
  let done = 0, blocked = 0, emptyKw = 0, noCardKw = 0, okKw = 0;
  for (const { q, name } of queries) {
    done++;
    // ページ送り（_pgn）で1キーワードから複数ページの落札を集める＝種を増やす。窓内カードを全ページ分ためてからまとめる。
    const allCards = []; let blockedThis = false, anyItems = false;
    for (let pg = 1; pg <= DISCOVER_PAGES; pg++) {
      let r;
      try { r = await get(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q.slice(0, 120))}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60&_pgn=${pg}`, "https://www.ebay.com/"); }
      catch (e) { r = { status: "err:" + (e?.name || e?.message), html: "" }; }
      if (typeof r.status !== "number" || r.status >= 400) { blockedThis = true; console.log(`  ⛔ ${r.status} : ${name} p${pg}`); await sleep(Math.round(rnd(15000, 30000))); break; }
      if (isBlocked(r.html)) { blockedThis = true; console.log(`  ⛔ 検問ページ : ${name} p${pg}`); await sleep(Math.round(rnd(30000, 60000))); break; }
      const parsed = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, true); // 輸出は新品単品が主→新品落札のみ採用
      if (parsed.items > 0) anyItems = true;
      allCards.push(...parsed.cards);
      if (parsed.items < 50) break; // ページが埋まってない＝最終ページ（これ以上のページは無い）。窓外で落札0のページもここで止まる
      if (pg < DISCOVER_PAGES) await jitterGap();
    }
    if (blockedThis) { blocked++; continue; }
    if (!anyItems) noCardKw++;
    if (!allCards.length) { emptyKw++; console.log(`  ・落札なし : ${name}`); await jitterGap(); continue; }

    // 似たタイトルをクラスタリングして「同一商品」を束ねる。eBayは出品者ごとにタイトル表記が違うため、完全一致だと
    // 同じ商品の複数落札が "soldCount=1 の別商品" に割れて実需を過小評価する。titleSim(単語overlap)≥SEED_SIM で束ね、
    // soldCount=クラスタの落札件数(=実需)・priceJpy=中央値・代表=直近カードのURL/画像。
    const clusters = [];
    for (const c of allCards) {
      if (!c?.title || !c?.url || !c?.img) continue;
      if (!(c.price >= SEED_MIN_JPY && c.price <= SEED_MAX_JPY)) continue; // 安物(単パック)/高額(バルク・別物)は枠を食うので除外
      if (PROHIBITED_EXCLUDE.test(c.title)) continue; // 【厳命】危険物はseed段階で除外（refresh側でも再除外＝二重ガード）
      if (LOT_RE.test(c.title)) continue;            // まとめ売り(Lot/bundle/x10)は単品でない＝除外
      let best = null, bestSim = 0;
      for (const cl of clusters) { const s = titleSim(c.title, cl.title); if (s > bestSim) { bestSim = s; best = cl; } }
      if (best && bestSim >= SEED_SIM) best.cards.push(c); // 既存クラスタに合流
      else clusters.push({ title: c.title, cards: [c] });   // 新規クラスタ
    }
    // 直近落札 SEED_MIN_SOLD 件以上に絞り、売れた件数が多い順（=実需が確かな順／同数なら直近）に上位 SEED_PER_KW をseed化。
    const ranked = clusters
      .filter((g) => g.cards.length >= SEED_MIN_SOLD)
      .sort((a, b) => (b.cards.length - a.cards.length) || (Math.min(...a.cards.map((c) => c.ageDays)) - Math.min(...b.cards.map((c) => c.ageDays))))
      .slice(0, SEED_PER_KW);
    let added = 0;
    for (const g of ranked) {
      const raw = g.cards.map((c) => c.price).sort((a, b) => a - b);
      const rmid = Math.floor(raw.length / 2);
      const rawMedian = raw.length % 2 ? raw[rmid] : Math.round((raw[rmid - 1] + raw[rmid]) / 2);
      // 少数サンプルだと「まとめ売り/別バリエ/異常値」1件で中央値が跳ねる(実例:LEGO10370が3件中央値で¥29,729)。
      // 中央値基準の価格帯[×0.45〜×2.2]の外を外れ値として除外→残りで中央値を再計算＝跳ねを抑える。
      const prices = (() => { const k = raw.filter((p) => p >= rawMedian * 0.45 && p <= rawMedian * 2.2); return k.length ? k : raw; })();
      const mid = Math.floor(prices.length / 2);
      const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
      // 代表＝価格が中央値に最も近い落札。soldUrl(落札リンク)/画像が想定売値(=中央値)と一致し、
      // 「リンク先の落札額が想定売値とズレる」乖離を防ぐ。同距離なら直近(ageDays小)を優先。
      const rep = g.cards.slice().sort(
        (a, b) => (Math.abs(a.price - median) - Math.abs(b.price - median)) || (a.ageDays - b.ageDays)
      )[0];
      seeds.push({ title: g.title, priceJpy: median, category: name, imageUrl: rep.img, itemUrl: rep.url, rank: added, soldCount: g.cards.length, soldWindowDays: WINDOW_DAYS });
      added++;
    }
    okKw++;
    console.log(`  ✅ ${name} → ユニーク${clusters.length}商品 / seed${added}（落札カード${allCards.length}・${DISCOVER_PAGES}ページ）`);
    await jitterGap();
  }

  // 系統的失敗ブレーキ：ほとんどのキーワードでカード0/検問＝UI変更 or IPブロックの疑い→何も書かない（旧種を温存）。
  const cardBreak = done >= BRAKE_MIN && okKw === 0 && noCardKw / done > 0.8;
  const healthy = !(cardBreak || (done >= BRAKE_MIN && blocked / done > BRAKE_RATIO));
  let wrote = 0;
  if (!healthy) {
    console.error(`🚨 発掘異常（OK${okKw}/カード0語${noCardKw}/検問${blocked} of ${done}）＝UI変更 or IPブロック疑い。ebay_sold_seed は更新せず旧種を温存。`);
  } else if (DRY) {
    console.log(`  [DRY] ${seeds.length}件のseed（書込なし）。先頭3件: ${JSON.stringify(seeds.slice(0, 3))}`);
  } else if (seeds.length) {
    if (await kvSetJson("ebay_sold_seed", seeds, SEED_TTL_S)) wrote = seeds.length;
  }
  await kvSetJson("ebay_sold_seed_status", { at: new Date().toISOString(), healthy, cardBreak, windowDays: WINDOW_DAYS, kw: done, okKw, emptyKw, noCardKw, blocked, seeds: seeds.length, wrote }, 14 * 24 * 3600);
  console.log(`発掘完了: キーワード${done} OK${okKw} 落札なし${emptyKw} カード0語${noCardKw} 検問${blocked} → seed${seeds.length} 書込${wrote}${DRY ? "(DRY)" : ""} healthy=${healthy}`);
}

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定"); process.exit(1); }
  return discoverSeeds(); // このワーカーは発掘モード専用（旧「現在出品×落札中央値」パスは廃止）
}
// 直接実行(Pixel: node scripts/ebaySoldWorker.mjs)の時だけ発掘を走らせる。
// import(型番リファイナ等)からは main を呼ばない＝パーサ(parseSoldWithin)/取得(get)だけ再利用するため。
if (process.argv[1]?.endsWith("ebaySoldWorker.mjs")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
