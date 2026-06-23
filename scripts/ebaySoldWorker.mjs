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
const MAX = Number(process.env.EBAY_SOLD_MAX ?? 60);
const GAP_MS = Number(process.env.EBAY_SOLD_GAP_MS ?? 4000);
const TTL_S = Number(process.env.EBAY_SOLD_TTL_H ?? 168) * 3600;
const FRESH_S = Number(process.env.EBAY_SOLD_FRESH_H ?? 20) * 3600; // 日次運用(24h間隔)で毎回再処理されるよう<24h。EBAY_SOLD_FRESH_H=0で全件強制
const MIN_SAMPLE = 3;
const WINDOW_DAYS = Number(process.env.EBAY_SOLD_WINDOW_DAYS ?? 30); // 直近この日数の落札だけ採用（既定30日）
const SANE_LO = Number(process.env.EBAY_SOLD_SANE_LO ?? 0.2); // 現相場×これ未満は破棄
const SANE_HI = Number(process.env.EBAY_SOLD_SANE_HI ?? 5);   // 現相場×これ超は破棄
const BRAKE_MIN = Number(process.env.EBAY_SOLD_BRAKE_MIN ?? 5);
const BRAKE_RATIO = Number(process.env.EBAY_SOLD_BRAKE_RATIO ?? 0.6); // 失敗率これ超で全書込中止
const TEST_KW = process.env.EBAY_SOLD_TEST || ""; // 指定すると カタログでなく このキーワード1件だけ診断（パーサ検証用）
const DEBUG = process.env.EBAY_SOLD_DEBUG === "1" || !!TEST_KW; // テスト時は自動でDEBUG
const DUMP = process.env.EBAY_SOLD_DUMP === "1"; // 先頭商品の生HTMLを scripts/_ebay_dump.html に保存（共有して原因解析）
const AUDIT = process.env.EBAY_SOLD_AUDIT === "1"; // 既存カタログを落札ベースで再判定し過大評価品を洗い出す（書込なし）

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

async function kvGet(key) {
  try { const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H }); const r = (await res.json()).result; if (r == null) return null; try { return JSON.parse(r); } catch { return r; } } catch { return null; }
}
async function kvSetJson(key, val, ttl) {
  try { const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(val))}?EX=${ttl}`, { method: "POST", headers: H }); return res.ok; } catch { return false; }
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
function parseSoldWithin(html, windowDays, usdJpy, wantNew = true) {
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
    if (im && um) cards.push({ price: jpy, ageDays: Math.round(age), url: `https://www.ebay.com/itm/${um[1]}`, img: im[1], title: al ? al[1].trim() : "" });
  }
  cards.sort((a, b) => a.ageDays - b.ageDays); // 直近(落札が新しい)順＝検証は先頭から
  return { prices, items, dated, withWindow, usedSkipped, cards };
}
function trimmedMedian(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y); if (!a.length) return null;
  const cut = a.length >= 8 ? Math.floor(a.length * 0.1) : 0; const t = a.slice(cut, a.length - cut); const mid = Math.floor(t.length / 2);
  return { median: t.length % 2 ? t[mid] : (t[mid - 1] + t[mid]) / 2, count: a.length };
}
async function get(url, referer) {
  const res = await fetch(url, { headers: browserHeaders(referer), redirect: "follow", signal: AbortSignal.timeout(20000) });
  storeCookies(res); return { status: res.status, html: await res.text() };
}
const isBlocked = (html) => /Pardon Our Interruption|Checking your browser|verify you are a human|to continue, please|captcha/i.test(html.slice(0, 4000));
// 検索語の清掃：「(Ships in early July)」等の括弧注記・先頭の "New!" マーケ語・予約販売マーカーを除去して空振りを防ぐ。
// ※"New 3DS" のように語中の New は商品名なので消さない（先頭の "New! " と括弧内のみ対象）。
function cleanKeyword(kw) {
  return String(kw || "")
    .replace(/\([^)]*\)/g, " ")                        // (Ships in early July) / (Pre-order) など括弧注記
    .replace(/^\s*new!\s+/i, " ")                      // 先頭の "New! "（マーケ語）だけ
    .replace(/\b(?:pre[-\s]?order|preorder)\b/gi, " ") // 予約販売ノイズ
    .replace(/\s+/g, " ").trim();
}

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定"); process.exit(1); }
  console.log(`eBay sold worker: DRY=${DRY} MAX=${MAX} GAP=${GAP_MS}ms USD_JPY=${USD_JPY}`);
  const catalog = TEST_KW ? [{ id: "test", coreKeyword: TEST_KW, realAvgPrice: 0 }] : ((await kvGet("profitable_products")) || []);
  if (!Array.isArray(catalog) || !catalog.length) { console.log("カタログ空"); return; }
  if (TEST_KW) console.log(`★テストモード: "${TEST_KW}"`);

  try { const w = await get("https://www.ebay.com", null); if (isBlocked(w.html)) console.log("  ⚠️ トップで検問。住宅IPでない可能性"); await sleep(Math.round(rnd(1200, 2500))); } catch {}

  const now = Math.floor(Date.now() / 1000);
  const buffer = []; // 健全な実行のときだけ最後にまとめて書く（汚染回避）
  const candBuffer = []; // 直近落札の候補(URL/画像/タイトル)。GitHub側refreshがAI同一判定して ebay_soldprice を確定させる材料
  const auditRows = [];
  let calcProfit, landedSubtractJpy;
  if (AUDIT) {
    ({ calcProfit } = await import("../app/lib/ebay/profitCore.mjs"));
    ({ landedSubtractJpy } = await import("../app/lib/ebay/landedCostCore.mjs"));
    console.log("★監査モード: 既存カタログを落札ベースで再判定（書込なし・現状○→落札✕＝過大評価を洗い出す）");
  }
  let done = 0, blocked = 0, thin = 0, implausible = 0, dateFail = 0, ok = 0, skipped = 0, noCard = 0;
  for (const p of catalog) {
    if (done >= MAX) break;
    const id = p?.id, rawKw = p?.coreKeyword || p?.title;
    if (!id || !rawKw) continue;
    const kw = cleanKeyword(rawKw) || rawKw; // 清掃後が空なら元に戻す
    const prev = await kvGet(`ebay_soldprice:${id}`);
    if (!AUDIT && prev?.at && now - Math.floor(new Date(prev.at).getTime() / 1000) < FRESH_S) { skipped++; continue; }

    done++;
    let r;
    try { r = await get(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(kw.slice(0, 120))}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`, "https://www.ebay.com/"); }
    catch (e) { r = { status: "err:" + (e?.name || e?.message), html: "" }; }
    if (typeof r.status !== "number" || r.status >= 400) { blocked++; console.log(`  ⛔ ${r.status} : ${kw.slice(0, 40)}`); await sleep(Math.round(rnd(15000, 30000))); continue; }
    if (isBlocked(r.html)) { blocked++; console.log(`  ⛔ 検問ページ : ${kw.slice(0, 40)}`); await sleep(Math.round(rnd(30000, 60000))); continue; }

    if (DUMP && done === 1) { try { fs.writeFileSync(new URL("./_ebay_dump.html", import.meta.url), r.html); console.log(`  [DUMP] scripts/_ebay_dump.html に保存 (${r.html.length} bytes)。git add/commit/push で共有してください`); } catch (e) { console.log("  [DUMP] 保存失敗:", e?.message); } }
    const parsed = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, p?.isNew !== false); // カタログ新品は新品落札のみで比較
    if (DEBUG && done === 1) {
      const h = r.html;
      console.log(`  [DEBUG] htmlLen=${h.length} status=${r.status} s-card__price=${(h.match(/s-card__price/g) || []).length} s-card__caption=${(h.match(/s-card__caption/g) || []).length} noResults=${/0 results|didn't match any|No exact matches/i.test(h)}`);
      console.log(`  [DEBUG] sold-date samples=${JSON.stringify([...h.matchAll(/s-card__caption[^>]*>\s*<span[^>]*>([^<]{3,30})/g)].slice(0, 3).map((m) => m[1].trim()))}`);
      console.log(`  [DEBUG] price samples=${JSON.stringify([...h.matchAll(/s-card__price[^>]*>\s*([^<]{1,16})/g)].slice(0, 5).map((m) => m[1].trim()))}`);
      console.log(`  [DEBUG] parsed cards=${parsed.items} dated=${parsed.dated} inWindow=${parsed.withWindow} 中古除外=${parsed.usedSkipped} priced=${parsed.prices.length} query="${kw.slice(0, 70)}"`);
    }
    if (parsed.items >= 5 && parsed.dated === 0) { dateFail++; console.log(`  ⚠️ 落札日が取れない(items${parsed.items}/dated0)＝Sold日付のUI変更疑い : ${kw.slice(0, 40)}`); await jitterGap(); continue; }
    if (parsed.items === 0) noCard++; // カードが1枚も無い＝本当に売れてない or マークアップ刷新（後でブレーキ判定）
    const stat = trimmedMedian(parsed.prices); // prices は既にJPY（×USD_JPY しない）
    if (!stat || stat.count < MIN_SAMPLE) { thin++; console.log(`  ・落札不足(窓内${stat?.count ?? 0}/items${parsed.items}/dated${parsed.dated}) : ${kw.slice(0, 40)}`); await jitterGap(); continue; }
    const medianJpy = Math.round(stat.median);
    // 妥当性：現eBay相場(realAvgPrice JPY)から極端に乖離＝パース誤り疑い→破棄。
    const anchor = Number(p?.realAvgPrice) || 0;
    if (anchor > 0 && (medianJpy < anchor * SANE_LO || medianJpy > anchor * SANE_HI)) {
      implausible++; console.log(`  ⚠️ 妥当性NG ¥${medianJpy} vs 現相場¥${anchor}（破棄） : ${kw.slice(0, 40)}`); await jitterGap(); continue;
    }
    ok++;
    const spRec = { median: medianJpy, medianUsd: Math.round((medianJpy / USD_JPY) * 100) / 100, count: stat.count, windowDays: WINDOW_DAYS, soldBased: true, at: new Date().toISOString() };
    if (prev?.verified && prev?.soldUrl) { spRec.verified = true; spRec.soldUrl = prev.soldUrl; } // 既存のAI確定(soldUrl)を中央値更新で消さない＝掲載のちらつき防止（refreshが再検証で更新）
    buffer.push({ key: `ebay_soldprice:${id}`, rec: spRec });
    // 直近落札の候補（最大12件）。refresh(GitHub・Anthropic鍵あり)がAI同一判定して実物URL付きで確定する。
    // 選び方：カタログが既に持つ同一品名(matchedEbayTitle)に「似てる順」で12件→そのうえで検証は直近順。
    //   別物が新着で上位を占めても同一品を候補に拾える。検索は1回のまま＝コスト不変。matchedEbayTitle無しは直近順。
    if (parsed.cards?.length) {
      const refTitle = p?.matchedEbayTitle || "";
      let candCards;
      if (refTitle && parsed.cards.length > 12) {
        candCards = parsed.cards.slice()
          .sort((a, b) => titleSim(b.title, refTitle) - titleSim(a.title, refTitle)) // 似てる順
          .slice(0, 12)
          .sort((a, b) => a.ageDays - b.ageDays); // 似てる上位12の中で検証は直近順
      } else {
        candCards = parsed.cards.slice(0, 12); // 直近順(parse済)
      }
      candBuffer.push({ key: `ebay_soldcand:${id}`, rec: { cards: candCards, windowCount: parsed.withWindow, at: new Date().toISOString() } });
    }
    console.log(`  ✅ 直近${WINDOW_DAYS}日 ${stat.count}件 中央¥${medianJpy}（候補${parsed.cards?.length ?? 0}） : ${kw.slice(0, 40)}`);
    if (AUDIT) {
      // 配信(displayProfit)と同一式で「現在出品相場ベース」と「落札ベース」の現金純利益率を出して比較。
      const point = p.source?.pointAmount ?? 0, ship = p.source?.shippingJpy ?? 0;
      const cashBuy = (p.source?.price ?? 0) + ship;
      const netOf = (ebayJpy, gross) => Math.round((gross ?? 0) - point - landedSubtractJpy(p.category, (ebayJpy || 0) / USD_JPY));
      const rateOf = (net) => (cashBuy > 0 ? Math.round((net / cashBuy) * 100) : 0);
      const rateList = rateOf(netOf(anchor, p.realProfit));               // 現状(現在出品相場)の純利益率
      const soldGross = calcProfit(p.source?.price ?? 0, medianJpy, point, ship).profit;
      const netSold = netOf(medianJpy, soldGross);
      const rateSold = rateOf(netSold);                                   // 落札ベースの純利益率
      auditRows.push({ id, kw: kw.slice(0, 46), listing: anchor, sold: medianJpy, count: stat.count, rateList, rateSold, netSold, overstated: rateList >= 10 && rateSold < 10 });
    }
    await jitterGap();
  }

  // 系統的失敗ブレーキ：失敗率が高い＝UI変更/IPブロックの疑い→この実行は何も書かない（汚染回避）。
  const failRatio = done ? (blocked + implausible + dateFail) / done : 0; // thin(=直近30日の出来高が少ない)は正常な薄さなのでブレーキ対象外
  // マークアップ刷新の検知：1枚もカードが取れない品が大多数で、かつ通過ゼロ＝eBayが構造を変えた疑い。
  //   今回(2025: s-item__→s-card__刷新)を取りこぼした教訓。thin扱いだとブレーキに掛からず healthy=true で握り潰すため、ここで別途検知。
  //   ※ノイズ防止：処理が十分(BRAKE_MIN)あり、ok===0、かつ noCard率>0.8 のときだけ「パーサ崩壊」と判定。
  const cardBreak = done >= BRAKE_MIN && ok === 0 && (noCard / done) > 0.8;
  const healthy = !((done >= BRAKE_MIN && failRatio > BRAKE_RATIO) || cardBreak);
  let wrote = 0;
  if (!healthy) {
    if (cardBreak) console.error(`🚨 商品カードが取れない（カード0件=${noCard}/${done}・通過0）＝eBayのHTML刷新(パーサ崩壊)の疑い。書込を全中止。parseSoldWithin の s-card__* セレクタ要確認。`);
    else console.error(`🚨 異常率 ${(failRatio * 100).toFixed(0)}%（ブロック${blocked}/妥当性NG${implausible}/落札日不可${dateFail} of ${done}）＝eBay UI変更 or IPブロックの疑い。書込を全中止。要確認。`);
  } else if (!DRY && !AUDIT) {
    for (const b of buffer) { if (await kvSetJson(b.key, b.rec, TTL_S)) wrote++; }
    for (const b of candBuffer) { await kvSetJson(b.key, b.rec, TTL_S); } // 候補（AI同一判定用）。TTLは soldprice と同じ
  }
  // 監視用サマリ（cron→メール通知に使える）。監査モードは書き込まない（汚さない）。
  if (!AUDIT) await kvSetJson("ebay_soldprice_status", { at: new Date().toISOString(), healthy, cardBreak, windowDays: WINDOW_DAYS, done, ok, wrote, blocked, thin, implausible, dateFail, noCard, failRatio: Math.round(failRatio * 100) }, 14 * 24 * 3600);
  console.log(`完了(直近${WINDOW_DAYS}日): 処理${done}/通過${ok}/書込${wrote}${DRY ? "(DRY)" : ""} ブロック${blocked} 落札不足${thin} 妥当性NG${implausible} 落札日不可${dateFail} カード0${noCard} 新鮮skip${skipped} healthy=${healthy}`);

  if (AUDIT) {
    const over = auditRows.filter((a) => a.overstated);
    console.log(`\n===== 監査結果：eBay直近落札ベースで再判定 =====`);
    console.log(`判定できた: ${auditRows.length}件 / 🔴過大評価(現状○→落札✕): ${over.length}件 / 判定不可(落札薄・取得失敗): ${thin + blocked + implausible}件`);
    for (const a of auditRows.sort((x, y) => x.rateSold - y.rateSold)) {
      console.log(`  ${a.overstated ? "🔴過大" : "  OK  "} 現相場¥${a.listing}(率${a.rateList}%) → 落札¥${a.sold}×${a.count}件(率${a.rateSold}%) : ${a.kw}`);
    }
    if (over.length) console.log(`\n--- 過大評価の商品ID（削除/出品停止の対象候補） ---\n${over.map((a) => a.id).join("\n")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
