#!/usr/bin/env node
// scripts/used/refineUsedCatalogEbay.mjs
// 【型番単位リファイナ（厳密・別型番を混ぜない）】used_catalog の各商品を「ブランド+型番(code)」でeBay落札検索し、
// ★タイトルに型番を含む落札だけ★を採用して中央値を出す＝同一型番の実落札のみで利益計算する。
// 同一型番が3件以上揃った商品だけ「型番一致」としてカタログに残し、揃わない商品は除外（別型番/系列平均で誤った利益を出さない）。
// さらに、その商品の eBay落札検索URL を ebaySoldUrl に保存（=「eBay落札を確認」ボタンのリンク先）。
// 落札パーサ/取得は ebaySoldWorker.mjs のSSOTを再利用。住宅IP・低頻度（warmup1回＋間隔＋ジッタ）。
// 使い方: node scripts/used/refineUsedCatalogEbay.mjs [limit]
import fs from "node:fs";
import { get, parseSoldWithin } from "../ebaySoldWorker.mjs";
import { landedSubtractJpy, EBAY_FEE_RATE } from "../../app/lib/ebay/landedCostCore.mjs";
import { ebayCompetition, hasEbayKeys } from "./ebayCompetition.mjs"; // eBay競合数(現在出品総数)。確定時に焼き込み。鍵が無ければnull(fail-open)。
import { upscaleImageflux } from "../../app/lib/imagefluxUpscale.mjs"; // imageFluxの小サムネURL→原寸級(1280px)。古いcatalog由来の小URLもpsnapに焼く前に原寸化。

const USD_JPY = 155;
const WINDOW_DAYS = 365; // 時計は値動きが遅い＋特定型番は出来高が薄いので落札窓は1年に広げ、同一型番の件数を確保
const GAP_MS = Number(process.env.EBAY_GAP_MS) || 8000;
// 1回あたりの処理件数（既定12＝小バッチ）。eBayのcaptchaは「同一セッションで連続十数件」で出るため、
// 一気に全件やらず、毎回 warmup 付きの小バッチで「細かく・多く」回す方が弾かれにくい（ユーザー指示2026-06-27）。
// 上書き：REFINE_LIMIT env もしくは argv[2]。フル実行したい時は大きい数を渡す。
const LIMIT = Number(process.env.REFINE_LIMIT || process.argv[2]) || 12;
const MIN_SAME = 1; // 同一型番(中古)がこの件数以上で相場確定（ユーザー指示2026-06-26：0件だけ弾き1件以上は出す）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(Math.round(GAP_MS * (1 + Math.random())));

function envv(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const KV_URL = envv("KV_REST_API_URL") || envv("UPSTASH_REDIS_REST_URL");
const KV_TOK = envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN");

// 純利益(JPY)。着地コストは配信/出品時と同じ SSOT(landedCostCore) で算出＝カタログの利益が実態と一致。category=ジャンルで重量概算。
function netProfitJPY(buyJpy, sellJpy, category) {
  const fee = sellJpy * EBAY_FEE_RATE + 47;
  const subtract = landedSubtractJpy(category, sellJpy / USD_JPY);
  return Math.round(sellJpy - fee - subtract - buyJpy);
}
function trimmedMedian(prices) {
  const ps = prices.slice().sort((a, b) => a - b);
  const raw = ps[Math.floor(ps.length / 2)];
  const kept = ps.filter((v) => v >= raw * 0.4 && v <= raw * 2.5);
  const k = kept.length ? kept : ps;
  return k[Math.floor(k.length / 2)];
}
// LH_ItemCondition=3000 ＝ 中古(Used/Pre-owned)のみ＝新品retailを相場計算/根拠表示から除外。
const soldUrl = (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); // 型番照合用の正規化（記号/大小無視）
// 新品(retail)を除外＝中古の落札だけで相場を出す。状態(cond)とタイトルの両方を見る。
const isNew = (s) => /^new\b|new with|new without|new \(other|brand\s?new|新品|未使用|未開封|dead\s?stock|デッドストック/i.test((s || "").trim());
// JDM(日本仕様)パッケージの接尾辞を外して国際リファレンスに寄せる（例 CASIO GM-2100B-4AJF → GM-2100B / OCW-70J-7AJF → OCW-70J）。
// eBayの中古落札タイトルは国際refで出るため、-4AJF/-7AJF等の付いた日本国内型番だと「同一型番」照合が0件→確定不能になっていた
// ＝時計だけ確定率が極端に低い主因（同じGショックでも GA-2100 は確定、GM-2100B-4AJF は全滅）。末尾がJF/JRの接尾辞だけ外す＝別モデルは混ざらない。
const coreCode = (code) => String(code || "").trim().replace(/-?\d{0,2}[A-Z]?J[FR]$/i, "").replace(/[-\s]+$/, "");
// 照合/検索/確定不能キャッシュの鍵に使う型番。時計だけ国際refに寄せる（短くなり過ぎる時は生の型番に戻す）。他ジャンルは生のまま＝精度不変。
const matchCodeOf = (p) => {
  if (p.cat !== "腕時計") return String(p.code || "").trim();
  const cc = coreCode(p.code);
  return cc.replace(/[^a-z0-9]/gi, "").length >= 4 ? cc : String(p.code || "").trim();
};

(async () => {
  const catalog = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  if (!catalog.length) { console.log("used_catalog が空"); return; }

  // ★競合数(ebayActiveCount)の取得に必要なeBay鍵の有無を毎回ログ＝KV(wlog:refine)経由でPC側から遠隔確認できる。
  //   「なし」＝Pixelの.env.localに EBAY_APP_ID/EBAY_CLIENT_SECRET が無い→競合数は焼き込まれない(fail-open)。
  console.log(`eBay競合鍵(EBAY_APP_ID/CLIENT_SECRET): ${hasEbayKeys() ? "あり ✓" : "なし→競合数スキップ(.env.localに2鍵を追加)"}`);

  // 確定不能(eBay落札0件)の型番キャッシュ＝無駄打ち削減。{normCode: 最後に確認したISO}。TTL以内は再scrapeせず、
  // バッチ枠を新規候補に回す＝実効の確定数が上がる。30日後に期限切れ→再挑戦(その間に新規落札が出ているかも)。
  // ★captcha(検問)では記録しない(取りこぼしを永久除外しない)。確定できたら削除する。
  const UNCONF_TTL_MS = (Number(process.env.REFINE_UNCONFIRMABLE_TTL_DAYS) || 30) * 864e5;
  const nowIso = new Date().toISOString();
  const unconf = await (async () => {
    try { const r = (await (await fetch(`${KV_URL}/get/ebay_unconfirmable`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result; const o = r ? JSON.parse(r) : {}; return o && typeof o === "object" ? o : {}; } catch { return {}; }
  })();
  const isUnconfFresh = (codeNorm) => { const t = unconf[codeNorm]; return !!t && (Date.now() - Date.parse(t)) < UNCONF_TTL_MS; };

  // 小バッチでも毎回ちゃんと前進するよう、未確認(ebayChecked無し)→未確定→確定済み の順で処理する。
  // ＝確定済みの上位ばかり再チェックして未確認が永遠に残るのを防ぐ。同ランク内は利益額の高い順。
  //   ※ catalog と同じオブジェクト参照を並べ替えるだけ（書き戻しは元の catalog ベースなので不変条件は保たれる）。
  const pri = (p) => (p.ebayConfirmed ? 2 : p.ebayChecked ? 1 : 0); // 0=未確認 を最優先
  // 確定不能キャッシュに載ってる型番(TTL内)はスキップ＝バッチ枠を新規候補に集中(確定済みは再確認のため残す)。
  const order = [...catalog]
    .filter((p) => p.ebayConfirmed || !isUnconfFresh(norm(matchCodeOf(p))))
    .sort((a, b) => pri(a) - pri(b) || (b.profitJpy || 0) - (a.profitJpy || 0));
  const pending = order.filter((p) => !p.ebayConfirmed).length;
  console.log(`対象 ${Math.min(order.length, LIMIT)} / ${order.length}件（未確定 ${pending}件・未確認優先・1回${LIMIT}件で確定${MIN_SAME}件以上）`);

  await get("https://www.ebay.com/"); // warmup（毎バッチ新セッション＝captcha回避）
  await sleep(1500);

  let confirmed = 0, dropped = 0, blocked = 0, n = 0;
  for (const p of order) {
    if (n >= LIMIT) break;
    n++;
    const code = matchCodeOf(p); // 時計はJDM接尾辞を外した国際refで検索/照合（他ジャンルは生の型番）
    // ⚠️ eBayは "-" を除外(NOT)演算子として扱う＝型番の "-" をそのまま検索すると "-XXXX" 以降が除外され落札が出ない。
    //    検索クエリは "-"→空白に置換（照合 norm は元から記号無視なので整合）。これで実際の型番落札がヒットし確認精度も上がる。
    const codeQ = code.replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const q = [p.brand, codeQ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    p.ebaySoldUrl = soldUrl(q); // 根拠ボタン＝ブランド+型番(ハイフン空白化)の落札検索
    const codeN = norm(code);
    // ★p.ebayChecked=true は「実際にeBayで確認できた」印。ブロック/エラーでは付けない＝取りこぼしを除外せず次回再確認。
    if (codeN.length < 4 || !p.brand) { p.ebayConfirmed = false; p.ebayChecked = true; if (codeN) unconf[codeN] = nowIso; console.log(`  ・ ${q} 型番が短い/無→相場確定せず（除外）`); continue; }
    let r;
    try { r = await get(soldUrl(q), "https://www.ebay.com/"); } catch (e) { console.log(`  [err] ${q}: ${e.message.slice(0, 30)}`); await jitter(); continue; }
    if (r.status !== 200 || /captcha|verify you|Pardon/i.test(r.html.slice(0, 3000))) { blocked++; console.log(`  [検問] ${q}（再確認待ち・残す）`); await jitter(); continue; }
    const { cards } = parseSoldWithin(r.html, WINDOW_DAYS, USD_JPY, false); // 中古=新品縛りしない
    // ★同一型番だけ：タイトル(正規化)に型番(正規化)を含む落札に限定＝別モデルを混ぜない。さらに新品(retail)を除外＝中古の実勢のみ。
    const same = cards.filter((c) => norm(c.title).includes(codeN) && !isNew(c.cond) && !isNew(c.title));
    p.ebayChecked = true;
    if (same.length >= MIN_SAME) {
      const med = trimmedMedian(same.map((c) => c.price));
      p.ebayMedianJpy = med; p.soldCount = same.length; p.ebayConfirmed = true;
      p.profitJpy = netProfitJPY(p.buyJpy, med, p.cat); p.profitRate = p.buyJpy > 0 ? Math.round((p.profitJpy / p.buyJpy) * 100) : 0; // 利益率＝純利益÷仕入れ(ROI)
      // 競合数(現在出品の総数)も同じバッチで焼き込む＝カードで「狙い目/多め」を一目表示。鍵が無ければ null のまま(fail-open)。
      const comp = await ebayCompetition(q);
      if (comp != null) p.ebayActiveCount = comp;
      delete unconf[codeN]; // 確定できた＝もう不能ではない(再挑戦キャッシュから外す)
      confirmed++;
      console.log(`  ✓ ${q.padEnd(30)} 同一型番${same.length}件 中央¥${med} → 益¥${p.profitJpy}(${p.profitRate}%)`);
    } else {
      p.ebayConfirmed = false;
      unconf[codeN] = nowIso; // eBay落札0件＝確定不能としてTTL記録＝次回以降スキップ(30日後に再挑戦)
      console.log(`  ・ ${q.padEnd(30)} 同一型番${same.length}件（不足→相場確定せず・除外）`);
    }
    await jitter();
  }

  // 残す＝「確認済みで同一型番が取れた黒字」 or 「まだ未確認(ブロック等)」。確認済みで不足/赤字のものだけ落とす。
  // ＝別型番混入や系列平均の誤った利益は排除しつつ、ブロックで取りこぼした商品は次回再確認できるよう温存。
  const before = catalog.length;
  const kept = catalog
    .filter((p) => (p.ebayChecked ? (p.ebayConfirmed && p.profitRate >= 10) : true)) // 対仕入れ(ROI)10%以上だけ。純益の絶対額フロアは撤廃＝配信ゲートと一致
    .sort((a, b) => (b.ebayConfirmed ? b.profitJpy : -1) - (a.ebayConfirmed ? a.profitJpy : -1));
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(kept) });
  // 確定不能キャッシュを掃除(期限切れ削除)して書き戻し(TTL90日でKV側も自然失効)。次バッチはここに載った型番をスキップ。
  for (const k of Object.keys(unconf)) { const t = Date.parse(unconf[k]); if (!t || (Date.now() - t) >= UNCONF_TTL_MS) delete unconf[k]; }
  await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify([["SET", "ebay_unconfirmable", JSON.stringify(unconf), "EX", String(90 * 24 * 3600)]]) });
  // 出品フロー用 psnap も同一型番相場で更新。TTL35日。
  const snapCmds = kept.filter((p) => p.id).map((p) => ["SET", `psnap:${p.id}`, JSON.stringify({
    id: p.id, title: `${p.brand} ${p.name}`.trim(), imageUrl: upscaleImageflux(p.imageUrl), images: p.imageUrl ? [upscaleImageflux(p.imageUrl)] : [],
    category: p.cat || "腕時計", coreKeyword: [p.brand, p.code].filter(Boolean).join(" ").trim(), brand: p.brand, code: p.code,
    realAvgPrice: p.ebayMedianJpy, realMedianPrice: p.ebayMedianJpy, realProfit: p.profitJpy, realProfitRate: p.profitRate,
    realCount: p.soldCount || 1, soldBased: !!p.ebayConfirmed, soldCount30d: p.soldCount, usedCondition: p.condition,
    ebayActiveCount: p.ebayActiveCount, // 競合数(現在出品総数)＝STR/競合バッジ用。未取得は undefined(中立)。
    source: { site: p.site || "hardoff", siteName: p.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: p.buyJpy, url: p.hardoffUrl },
  }), "EX", String(35 * 24 * 3600)]);
  if (snapCmds.length) await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(snapCmds) });

  console.log(`\n=== 同一型番で確定 ${confirmed}件 / 検問 ${blocked}件 ===`);
  console.log(`相場確定せず/赤字で除外 ${before - kept.length}件 → used_catalog 計 ${kept.length}件（全て型番一致）`);
})();
