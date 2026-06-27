#!/usr/bin/env node
// scripts/used/buildUsedSampleFromCache.mjs
// 【中古利益サンプル（eBay落札キャッシュ × ハードオフ）】
// eBayを叩かず、Pixelが集めた実落札キャッシュ KV `ebay_sold_seed`(3,183件・priceJpy=実落札中央/category=狭い型番系列)を
// 「想定売値」に使い、ハードオフ現在庫(買い)と突合→送料/関税/手数料後の純利益で「儲かる中古」を抽出する。
// 住宅IP・低頻度（ハードオフのみ・逐次+待ち）。サンプル件数とカタログをKV used_catalog に書き、Resendでメール送信する。
import fs from "node:fs";
import { fetchHardoff } from "./fetchHardoff.mjs";
import { USED_GENRE_KW, PROHIBITED_EXCLUDE } from "../ebayQueries.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USD_JPY = 155;

function env(k) {
  if (process.env[k]) return process.env[k]; // Pixel(Termux)は環境変数
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const KV_URL = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const KV_TOK = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
const RESEND = env("RESEND_API_KEY");

// 純利益(JPY)。買=ハードオフ価格、売=eBay落札中央。重量500g想定・国際送料は買い手負担(手数料分のみ計上)。
function netProfitJPY(buyJpy, sellJpy) {
  const fee = sellJpy * 0.1325 + 47;          // eBay最終手数料
  const shipFee = 2040 * 0.1325;               // 国際送料にかかる手数料分
  const sellUsd = sellJpy / USD_JPY;
  // 米関税: $500以上は真贋保証(AG)経由で買い手負担→セラーは引かない。$500未満は標準出品でDDP必須=セラーが前払い
  //   (時計の実効≒15%＋通関手数料¥3000。第122条の上乗せは2026-07-24失効予定で流動的なので保守的に概算)。
  const dutyJpy = sellUsd >= 500 ? 0 : Math.round(sellJpy * 0.15 + 3000);
  return Math.round(sellJpy - fee - shipFee - dutyJpy - buyJpy);
}

// 中古サイト(ハードオフ)で扱えない/相性が悪いカテゴリは除外。
//  ・コスメ/食品/消耗ペン＝中古で売らない
//  ・カード/TCG＝eBay(封入/鑑定品)とハードオフ(バラ/まとめ)がカテゴリ単位照合だと誤マッチ→型番照合できるまで除外
// ※MTGは「マジック:ザ・ギャザリング」除外用だが MTG-B2000(高級Gショック)等の型番と衝突するため、後ろにハイフン/英数が続く型番は除外しない(MTG(?![-\w]))。
const EXCLUDE = /資生堂|キャンメイク|DHC|ルルルン|セザンヌ|KATE|ファンデ|チーク|アイシャドウ|クレンジング|フェイスマスク|眉ペンシル|コスメ|リップ|エナージェル|ジェットストリーム|ぺんてる|ボールペン|シャーペン|ノック式|食品|お菓子|レトルト|カード|ポケカ|MTG(?![-\w])|ヴァンガード|遊戯王|テラスタル|デュエ|バトスピ|ユニオンアリーナ|ヴァイス|ビルディバイド|シャドウバース/i;
// 【対象ジャンル＝ハードオフ中古の本領】2026-06-26 時計のみ→拡張。型番で売れる中古(時計/オーディオ/カメラ・レンズ/
//   レトロゲーム機/エフェクター)を対象に。SSOT=USED_GENRE_KW(ebayQueries)。発掘フィルタと同じ正規表現で揃える。
// 商品レベルの除外：「カマス(魚)」等で釣具が混じる→釣具の明確な語を弾く（時計検索の混入対策・他ジャンルでは無害）。
const NONWATCH = /ダイワ|DAIWA|シマノ|SHIMANO|メジャークラフト|MAJOR\s?CRAFT|がまかつ|アブガルシア|ロッド|リール|釣|竿|紅牙|朱紋峰|ルアー|フィッシング/i;

// カテゴリ名(シードのname)→表示カテゴリ。商品カードの「ジャンル」バッジに出す。
function genreOf(category) {
  const c = category || "";
  if (/腕時計|ウォッチ|セイコー|シチズン|カシオ|Gショック|G-?SHOCK|オリエント|オシアナス|アテッサ|プロマスター|エディフィス|プロトレック|ロイヤルAE|F91W|ダイバー|クロノグラフ|watch|ハミルトン|タイメックス|スウォッチ/i.test(c)) return "腕時計";
  if (/レンズ|フィルムカメラ|一眼|カメラ|デジカメ|ミラーレス|ボディ|キヤノン|キャノン|ニコン|フジフイルム|富士フイルム|オリンパス|ペンタックス|ライカ|コンタックス|LUMIX|パナソニック|シグマ|タムロン/i.test(c)) return "カメラ";
  if (/ファミコン|スーパーファミコン|ニンテンドー|任天堂|NINTENDO|ゲームボーイ|ゲームキューブ|セガ|サターン|ドリームキャスト|メガドライブ|プレイステーション|プレステ|PSP|Vita|ゲーム機|コントローラー|本体/i.test(c)) return "ゲーム機";
  if (/エフェクター|ギター|ベース|シンセ|シンセサイザー|キーボード|インターフェース|ドラムマシン|BOSS|Roland|Korg|Electro-Harmonix|Focusrite|Ibanez|Strymon|MXR/i.test(c)) return "楽器";
  if (/電動工具|インパクトドライバー|ドリル|マキタ|HiKOKI|ハイコーキ|工具/i.test(c)) return "工具";
  if (/ウォークマン|ヘッドホン|ヘッドフォン|イヤホン|iPod|ターンテーブル|アンプ|スピーカー|カセットデッキ|デッキ|レコードプレーヤー|MDプレーヤー|カートリッジ|交換針|チューナー|オープンリール|ディスクマン|カセット|Hi-MD|\bMD\b|アイワ|AIWA|オーディオ|テクニクス|パイオニア|マランツ|サンスイ|デノン|オンキヨー|ティアック|ケンウッド|アキュフェーズ|ラックスマン|オーディオテクニカ|ゼンハイザー/i.test(c)) return "オーディオ";
  return "中古";
}

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
  // ハードオフ中古の本領ジャンル＋値ごろ（中央¥6000以上）＋非除外。需要(soldCount)順。
  return cats
    .filter((c) => c.ebayMedian >= 6000 && USED_GENRE_KW.test(c.category) && !EXCLUDE.test(c.category))
    .sort((a, b) => b.soldCount - a.soldCount);
}

(async () => {
  const all = await loadCategories(); // ハードオフ中古ジャンル（時計/オーディオ/カメラ/ゲーム機/エフェクター）

  const catalog = [];
  const TARGET = Number(process.env.TARGET) || 600; // 候補の総上限（env TARGET で調整可・上げると候補↑＝refineのeBay負荷↑）
  const CAP_PER_CAT = Number(process.env.CAP_PER_CAT) || 20; // 1カテゴリあたりの上限（env CAP_PER_CAT で調整可）
  const PAGES = Number(process.env.HARDOFF_PAGES) || 3; // 1カテゴリで取るハードオフ検索ページ数（増やすと候補↑＝供給拡大の主レバー）
  let scanned = 0;
  for (const c of all) {
    if (catalog.length >= TARGET) break;
    scanned++;
    // ページ送りで在庫を深掘り（narrowなクエリは2ページ目以降が空になり次第打ち切る）。URLで重複排除。
    let items = [];
    const seenUrl = new Set();
    for (let page = 1; page <= PAGES; page++) {
      let pageItems = [];
      try { pageItems = await fetchHardoff(c.query, { page }); } catch { /* skip */ }
      await sleep(1600);
      const fresh = pageItems.filter((it) => it.url && !seenUrl.has(it.url));
      fresh.forEach((it) => seenUrl.add(it.url));
      items.push(...fresh);
      if (fresh.length === 0) break; // これ以上ページが無い＝打ち切り（無駄打ち防止）
    }
    let added = 0;
    for (const it of items) {
      if (!it.price) continue;
      if (NONWATCH.test(`${it.brand} ${it.name}`)) continue; // 釣具等の非時計を除外
      if (PROHIBITED_EXCLUDE.test(`${it.brand} ${it.name}`)) continue; // 【厳命】航空危険物/国際発送不可は絶対に対象外
      // ※ジャンク(動作未確認/部品取り)も掲載対象にする（ユーザー指示2026-06-27）。出品時に状態を説明文で明示してクレーム回避。
      const ratio = it.price / c.ebayMedian;
      // ガード：仕入れがeBay中央の15〜80%（ミスマッチ＝極端に安い/高いを除外）。
      if (ratio < 0.15 || ratio > 0.8) continue;
      const net = netProfitJPY(it.price, c.ebayMedian);
      const roi = it.price > 0 ? net / it.price : 0; // 利益率＝純利益÷仕入れ値(ROI)。配信(getUsedCatalog)と同じ定義で判定する。
      // 採用条件は「対仕入れ10%以上」だけ（純益の絶対額フロアは撤廃・ユーザー指示2026-06-28）。
      if (roi >= 0.1) {
        const idNum = (it.url.match(/\/(?:product|goodsId)\/(\d+)/) || [])[1] || it.url.replace(/\D+/g, "").slice(-12);
        catalog.push({
          id: `used-hardoff-${idNum}`,
          modelKey: (it.code || it.name || "").slice(0, 60), brand: it.brand, name: it.name, code: it.code,
          cat: genreOf(c.category), ebayMedianJpy: c.ebayMedian, buyJpy: it.price, condition: it.condition,
          profitJpy: net, profitRate: it.price > 0 ? Math.round((net / it.price) * 100) : 0, hardoffUrl: it.url, imageUrl: it.imageUrl,
          site: "hardoff", soldCount: c.soldCount,
        });
        added++;
        if (added >= CAP_PER_CAT) break; // 1カテゴリ偏重を防ぐ（多様性）
      }
    }
    if (added) console.log(`+${String(added).padStart(2)}  ${c.category.padEnd(20)} eBay中央¥${c.ebayMedian}  (計${catalog.length})`);
  }

  catalog.sort((a, b) => b.profitJpy - a.profitJpy);
  console.log(`\n=== 利益候補 ${catalog.length}件（${scanned}カテゴリ走査）===`);
  catalog.slice(0, 12).forEach((c) => console.log(`  [${c.cat}/${c.condition || "中古"}] ${c.brand} ${c.name} 買¥${c.buyJpy}→売¥${c.ebayMedianJpy} 益¥${c.profitJpy}(${c.profitRate}%)`));

  // KVへ。既存の2nd ST候補は温存（buildはハードオフ候補を作るだけ）。
  // ★重要：buildはハードオフ品を ebayConfirmed 無しの素の状態で作る。そのまま上書きすると、
  //   refineUsedCatalogEbay が型番一致でつけた ebayConfirmed/相場が毎build消え、カタログが「確定分だけ」に崩落する。
  //   → 既存の確定結果(型番=code 単位)を新規build品へ引き継ぐ。同一型番なら eBay落札中央値は同じなので妥当。
  let enriched = catalog;
  let merged = catalog;
  try {
    const existing = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
    const normCode = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // 型番→確定相場（refine済み・ebayConfirmed）の対応表。同一型番は最初の確定を採用。
    const refinedByCode = new Map();
    for (const p of existing) {
      const k = normCode(p.code);
      if (k && p.ebayConfirmed && Number(p.ebayMedianJpy) > 0 && !refinedByCode.has(k)) refinedByCode.set(k, p);
    }
    let carried = 0;
    enriched = catalog.map((c) => {
      const prev = refinedByCode.get(normCode(c.code));
      if (!prev) return c;
      const median = Number(prev.ebayMedianJpy); // 型番一致の確定相場
      const net = netProfitJPY(c.buyJpy, median); // 仕入れは新規品の値、相場は確定値で利益を再計算
      carried++;
      return {
        ...c, ebayMedianJpy: median, profitJpy: net, profitRate: c.buyJpy > 0 ? Math.round((net / c.buyJpy) * 100) : 0, // 利益率＝純利益÷仕入れ(ROI)
        soldCount: prev.soldCount ?? c.soldCount, ebayConfirmed: true, ebayChecked: true, ebaySoldUrl: prev.ebaySoldUrl,
      };
    });
    const haveUrls = new Set(catalog.map((p) => p.hardoffUrl));
    const keep2ndst = existing.filter((p) => p.site === "2ndstreet" && !haveUrls.has(p.hardoffUrl));
    merged = [...enriched, ...keep2ndst];
    console.log(`  (確定相場を引き継ぎ ${carried}件 / 2nd ST温存 ${keep2ndst.length}件)`);
  } catch { /* 既存取得失敗時はハードオフ分のみ */ }
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(merged) });
  console.log(`💾 KV used_catalog に ${merged.length}件 書込（うち確定 ${merged.filter((p) => p.ebayConfirmed).length}件）`);

  // 出品フロー用に psnap:{id} へ ProfitProduct を保存（prepare/publish が getProductById で引く）。TTL35日。
  // 仕入れ先サイトは c.site から導出（ここで作る catalog はハードオフのみだが、将来 merged を回しても誤ラベルしないよう堅牢化）。
  // ※2nd ST候補のpsnapは refineUsedCatalogEbay が site 込みで書く。想定売値=eBay落札中央値。実物写真は出品時に本人が差し替える前提。
  const cmds = enriched.map((c) => {
    const snap = {
      id: c.id, title: `${c.brand} ${c.name}`.trim(), imageUrl: c.imageUrl, images: c.imageUrl ? [c.imageUrl] : [],
      category: c.cat || "腕時計", coreKeyword: [c.brand, c.code].filter(Boolean).join(" ").trim(), brand: c.brand, code: c.code,
      realAvgPrice: c.ebayMedianJpy, realMedianPrice: c.ebayMedianJpy, realProfit: c.profitJpy, realProfitRate: c.profitRate,
      realCount: c.soldCount || 1, soldBased: !!c.ebayConfirmed, usedCondition: c.condition,
      source: { site: c.site || "hardoff", siteName: c.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: c.buyJpy, url: c.hardoffUrl },
    };
    return ["SET", `psnap:${c.id}`, JSON.stringify(snap), "EX", String(35 * 24 * 3600)];
  });
  if (cmds.length) {
    await fetch(`${KV_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds) });
    console.log(`💾 psnap ${cmds.length}件 書込（出品フロー用）`);
  }

  // メール本文を組み立て→ファイルにも書き出し（ローカルにRESEND鍵値が無くても中身を確認/共有できるように）。
  const rows = catalog.slice(0, 40).map((c) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${c.cat}</td><td style="padding:4px 8px;border-bottom:1px solid #eee">${c.brand} ${c.name}${c.code ? "（" + c.code + "）" : ""}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${c.condition || "中古"}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">¥${c.buyJpy.toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;color:#0064D2">¥${c.ebayMedianJpy.toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:#A98B5C">+¥${c.profitJpy.toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${c.profitRate}%</td><td style="padding:4px 8px;border-bottom:1px solid #eee"><a href="${c.hardoffUrl}">見る</a></td></tr>`
  ).join("");
  const html = `<div style="font-family:sans-serif;color:#2D323B">
  <h2>中古の利益カタログ サンプル（${catalog.length}件）</h2>
  <p>eBay落札の実データ（Pixel収集）× ハードオフ現在庫で、送料・関税・手数料を引いた純利益で抽出した「儲かる中古」の上位40件です。eBay想定売値はカテゴリ（型番系列）中央値ベースの目安、状態・競合・為替で変動します。</p>
  <p><b>全${catalog.length}件</b>が利益候補（利益率(対仕入れ/ROI)10%以上）。</p>
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
