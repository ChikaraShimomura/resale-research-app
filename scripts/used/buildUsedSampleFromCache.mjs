#!/usr/bin/env node
// scripts/used/buildUsedSampleFromCache.mjs
// 【中古利益サンプル（eBay落札キャッシュ × ハードオフ）】
// eBayを叩かず、Pixelが集めた実落札キャッシュ KV `ebay_sold_seed`(3,183件・priceJpy=実落札中央/category=狭い型番系列)を
// 「想定売値」に使い、ハードオフ現在庫(買い)と突合→送料/関税/手数料後の純利益で「儲かる中古」を抽出する。
// 住宅IP・低頻度（ハードオフのみ・逐次+待ち）。サンプル件数とカタログをKV used_catalog に書き、Resendでメール送信する。
import fs from "node:fs";
import { fetchHardoff } from "./fetchHardoff.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USD_JPY = 155;

function env(k) {
  const e = fs.readFileSync(".env.local", "utf8");
  const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}
const KV_URL = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const KV_TOK = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
const RESEND = env("RESEND_API_KEY");

// 純利益(JPY)。買=ハードオフ価格、売=eBay落札中央。重量500g想定・国際送料は買い手負担(手数料分のみ計上)。
function netProfitJPY(buyJpy, sellJpy) {
  const fee = sellJpy * 0.1325 + 47;
  const shipFee = 2040 * 0.1325;
  const dutyJpy = sellJpy / USD_JPY > 100 ? sellJpy * 0.1 + 230 : 0;
  return Math.round(sellJpy - fee - shipFee - dutyJpy - buyJpy);
}

// 中古サイト(ハードオフ)で扱えない/相性が悪いカテゴリは除外。
//  ・コスメ/食品/消耗ペン＝中古で売らない
//  ・カード/TCG＝eBay(封入/鑑定品)とハードオフ(バラ/まとめ)がカテゴリ単位照合だと誤マッチ→型番照合できるまで除外
const EXCLUDE = /資生堂|キャンメイク|DHC|ルルルン|セザンヌ|KATE|ファンデ|チーク|アイシャドウ|クレンジング|フェイスマスク|眉ペンシル|コスメ|リップ|エナージェル|ジェットストリーム|ぺんてる|ボールペン|シャーペン|ノック式|食品|お菓子|レトルト|カード|ポケカ|MTG|ヴァンガード|遊戯王|テラスタル|デュエ|バトスピ|ユニオンアリーナ|ヴァイス|ビルディバイド|シャドウバース/i;

async function loadCategories() {
  const r = await fetch(`${KV_URL}/get/ebay_sold_seed`, { headers: { Authorization: `Bearer ${KV_TOK}` } });
  const seed = JSON.parse((await r.json()).result);
  const by = {};
  for (const s of seed) {
    if (!s.category || !s.priceJpy) continue;
    (by[s.category] = by[s.category] || []).push(s);
  }
  const cats = Object.entries(by).map(([category, arr]) => {
    const prices = arr.map((x) => x.priceJpy).sort((a, b) => a - b);
    const ebayMedian = prices[Math.floor(prices.length / 2)];
    const soldCount = arr.reduce((s, x) => s + (x.soldCount || 0), 0);
    return { category, ebayMedian, soldCount, n: arr.length, query: category };
  });
  // 中古向き＋値ごろ（中央¥4000以上）＋非除外。需要(soldCount)順。
  return cats
    .filter((c) => c.ebayMedian >= 4000 && !EXCLUDE.test(c.category))
    .sort((a, b) => b.soldCount - a.soldCount);
}

(async () => {
  // 実測の音響カテゴリ（キャッシュに無いが強いので手動で足す）。
  const EXTRA = [{ category: "Pioneer アンプ", ebayMedian: 20627, soldCount: 8, query: "Pioneer アンプ", cat: "音響" }];
  const cacheCats = await loadCategories();
  const all = [...EXTRA, ...cacheCats];

  const catalog = [];
  const TARGET = 60; // 数十件
  let scanned = 0;
  for (const c of all) {
    if (catalog.length >= TARGET) break;
    scanned++;
    let items = [];
    try { items = await fetchHardoff(c.query); } catch { /* skip */ }
    await sleep(1600);
    let added = 0;
    for (const it of items) {
      if (!it.price) continue;
      const ratio = it.price / c.ebayMedian;
      // ガード：仕入れがeBay中央の15〜80%（ミスマッチ＝極端に安い/高いを除外）。
      if (ratio < 0.15 || ratio > 0.8) continue;
      const net = netProfitJPY(it.price, c.ebayMedian);
      const rate = net / c.ebayMedian;
      if (net > 1500 && rate > 0.15) {
        catalog.push({
          modelKey: (it.code || it.name || "").slice(0, 60), brand: it.brand, name: it.name, code: it.code,
          cat: c.cat || c.category, ebayMedianJpy: c.ebayMedian, buyJpy: it.price, condition: it.condition,
          profitJpy: net, profitRate: Math.round(rate * 100), hardoffUrl: it.url, imageUrl: it.imageUrl,
          site: "hardoff", soldCount: c.soldCount,
        });
        added++;
        if (added >= 4) break; // 1カテゴリ偏重を防ぐ（多様性）
      }
    }
    if (added) console.log(`+${String(added).padStart(2)}  ${c.category.padEnd(20)} eBay中央¥${c.ebayMedian}  (計${catalog.length})`);
  }

  catalog.sort((a, b) => b.profitJpy - a.profitJpy);
  console.log(`\n=== 利益候補 ${catalog.length}件（${scanned}カテゴリ走査）===`);
  catalog.slice(0, 12).forEach((c) => console.log(`  [${c.cat}/${c.condition || "中古"}] ${c.brand} ${c.name} 買¥${c.buyJpy}→売¥${c.ebayMedianJpy} 益¥${c.profitJpy}(${c.profitRate}%)`));

  // KVへ。
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(catalog) });
  console.log(`💾 KV used_catalog に ${catalog.length}件 書込`);

  // メール本文を組み立て→ファイルにも書き出し（ローカルにRESEND鍵値が無くても中身を確認/共有できるように）。
  const rows = catalog.slice(0, 40).map((c) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${c.cat}</td><td style="padding:4px 8px;border-bottom:1px solid #eee">${c.brand} ${c.name}${c.code ? "（" + c.code + "）" : ""}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${c.condition || "中古"}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">¥${c.buyJpy.toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;color:#0064D2">¥${c.ebayMedianJpy.toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:#A98B5C">+¥${c.profitJpy.toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${c.profitRate}%</td><td style="padding:4px 8px;border-bottom:1px solid #eee"><a href="${c.hardoffUrl}">見る</a></td></tr>`
  ).join("");
  const html = `<div style="font-family:sans-serif;color:#2D323B">
  <h2>中古の利益カタログ サンプル（${catalog.length}件）</h2>
  <p>eBay落札の実データ（Pixel収集）× ハードオフ現在庫で、送料・関税・手数料を引いた純利益で抽出した「儲かる中古」の上位40件です。eBay想定売値はカテゴリ（型番系列）中央値ベースの目安、状態・競合・為替で変動します。</p>
  <p><b>全${catalog.length}件</b>が利益候補（純益¥1,500超・利益率15%超）。</p>
  <table style="border-collapse:collapse;font-size:13px;width:100%">
    <tr style="background:#2D323B;color:#fff"><th style="padding:6px 8px;text-align:left">ジャンル</th><th style="padding:6px 8px;text-align:left">商品</th><th style="padding:6px 8px">状態</th><th style="padding:6px 8px">仕入れ</th><th style="padding:6px 8px">eBay想定</th><th style="padding:6px 8px">純利益</th><th style="padding:6px 8px">率</th><th style="padding:6px 8px">仕入れ先</th></tr>
    ${rows}
  </table>
  <p style="color:#888;font-size:12px;margin-top:16px">※ 中古は1点物のため在庫は流動的。eBay想定売値は型番系列の中央値（型番単位の精密化はワーカー稼働で順次）。輸出ラボ</p>
  </div>`;
  fs.writeFileSync("scripts/used/_used_sample.html", `<!doctype html><meta charset="utf-8"><title>中古の利益カタログ サンプル</title>${html}`);
  console.log(`📝 HTMLサンプル: scripts/used/_used_sample.html`);
  if (!RESEND) { console.log("⚠️ RESEND_API_KEY の値が空（鍵はGitHub/Vercel側のみ）→ローカルからは未送信。HTMLは書き出し済み。"); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "輸出ラボBot <noreply@yushutsu-fukugyo.com>", to: ["chikara0323@gmail.com"], subject: `【輸出ラボ】中古の利益カタログ サンプル ${catalog.length}件`, html }),
  });
  console.log("📧 Resend:", res.status, (await res.text()).slice(0, 120));
})();
