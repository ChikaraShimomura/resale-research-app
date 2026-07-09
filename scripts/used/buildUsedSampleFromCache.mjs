#!/usr/bin/env node
// scripts/used/buildUsedSampleFromCache.mjs
// 【中古利益サンプル（eBay落札キャッシュ × ハードオフ）】
// eBayを叩かず、Pixelが集めた実落札キャッシュ KV `ebay_sold_seed`(3,183件・priceJpy=実落札中央/category=狭い型番系列)を
// 「想定売値」に使い、ハードオフ現在庫(買い)と突合→送料/関税/手数料後の純利益で「儲かる中古」を抽出する。
// 住宅IP・低頻度（ハードオフのみ・逐次+待ち）。サンプル件数とカタログをKV used_catalog に書き、Resendでメール送信する。
import fs from "node:fs";
import { fetchHardoff } from "./fetchHardoff.mjs";
import { USED_GENRE_KW, BRAND_USED_KW, PROHIBITED_EXCLUDE } from "../ebayQueries.mjs";
import { landedSubtractJpy, ebayFeeRate, ebayFeeFixedJpy } from "../../app/lib/ebay/landedCostCore.mjs";
import { upscaleImageflux } from "../../app/lib/imagefluxUpscale.mjs"; // imageFluxの小サムネURL→原寸級(1280px)。既存catalogをmergeした古い小URLもpsnapに焼く前に原寸化。

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

// 純利益(JPY)。着地コストは配信/出品時と同じ SSOT(landedCostCore) で算出＝カタログの利益表示が実態(出品時の損益分岐)と一致する。
// category=ジャンル(WEIGHT_Gのキー)で重量を概算。出品者負担＝送料へのeBay手数料＋米国関税($100超)＋定額送料の不足。送料自体は買い手負担。
function netProfitJPY(buyJpy, sellJpy, category) {
  const fee = sellJpy * ebayFeeRate(category) + ebayFeeFixedJpy(); // カテゴリ別実効手数料(FVF+海外決済+為替)＋固定$0.40。時計は15%。
  const subtract = landedSubtractJpy(category, sellJpy / USD_JPY);
  return Math.round(sellJpy - fee - subtract - buyJpy);
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
  // ブランド品(2026-07-07)。時計は上の腕時計バケツで拾う（海外ファッション時計も name に「腕時計」を含む）。ここはバッグ/財布・ジュエリー。
  if (/バッグ|ハンドバッグ|トートバッグ|ショルダーバッグ|ボストンバッグ|財布|長財布|ウォレット/i.test(c)) return "バッグ";
  if (/ジュエリー|ネックレス|指輪|ブレスレット|ピアス|イヤリング|貴金属/i.test(c)) return "ジュエリー";
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
    .filter((c) => c.ebayMedian >= 6000 && (USED_GENRE_KW.test(c.category) || BRAND_USED_KW.test(c.category)) && !EXCLUDE.test(c.category))
    .sort((a, b) => b.soldCount - a.soldCount);
}

(async () => {
  const all = await loadCategories(); // ハードオフ中古ジャンル（時計/オーディオ/カメラ/ゲーム機/エフェクター）

  const catalog = [];
  // 精度極限ゲート(getUsedCatalog=確定品のみ配信)により、未確定候補は表示されず「確定待ちキュー」になる。
  // ＝候補を厚く貯めても精度は落ちない。キューを厚くするほど refine が確定できる型番の母数が増える(歩留まり↑)。
  const TARGET = Number(process.env.TARGET) || 5000; // 候補の総上限（確定待ちキュー）。実際の配分は per-genre 上限が主で、これは全体の安全弁。
  const CAP_PER_CAT = Number(process.env.CAP_PER_CAT) || 60; // 1カテゴリ(型番系列)上限。※実測で40に当たる系列は全419中2つだけ＝ほぼ非拘束。深掘り分を受ける程度に微増。
  // ⌚時計は注力ジャンル＝需要・ハードオフ在庫が深く確定率も高い。系列ごとの上限を厚くして増やす（既取得ページから拾うだけ＝追加fetch無し）。
  const CAP_WATCH = Number(process.env.CAP_WATCH) || 150;
  // ★ジャンルあたりの候補上限（ユーザー指示2026-07-01：全ジャンルを~1000件ずつ・ゲーム偏重を防ぐ）。
  //   カテゴリはsoldCount順に処理するため、上限が無いと歩留まり・需要の高いゲームが TARGET を食い尽くし他ジャンルが枯れる。ジャンルごとに均等配分する。
  const CAP_PER_GENRE = Number(process.env.CAP_PER_GENRE) || 1000;
  const PAGES = Number(process.env.HARDOFF_PAGES) || 12; // 1カテゴリで取るハードオフ検索ページ数（深掘り）。★実質の供給レバー＝大半の系列が「CAPでなくページ深度」で頭打ちのため最大化（2026-07-02: 8→12で候補の母数UP）。空ページで即打切りなので狭い系列(時計等)は無駄打ちしない＝主に広いカテゴリ(ゲーム/カメラ/オーディオ)の候補が増える。2h毎の低頻度なので12でも常識内。
  // ⌚時計は OFFモールの在庫が桁違いに厚い(腕時計だけで約2.5万件)＋確定headroom大(CAP_WATCH150/genre1000に対し実数~88)。
  //   広い時計クエリ(セイコー/カシオ/シチズン/オリエント等)はページ深度で頭打ちなので、時計だけ深く掘る(既定24)。
  //   狭い型番クエリは空ページで即打切りなので無駄打ちしない＝増えるのは広い時計クエリぶんだけ(build時間の増分は限定的)。ユーザー指示2026-07-04。
  const PAGES_WATCH = Number(process.env.HARDOFF_PAGES_WATCH) || 24;
  const genreCount = {}; // ジャンル別の投入数（per-genre 上限の判定用）
  const seenId = new Set();  // ★グローバル重複排除：同じハードオフ品が別カテゴリ検索で複数回ヒットするのを1回に(重複ID 57件の根治)。
  const modelCount = {};     // ★同一モデル上限：BOSS BD2 が25件…等の1モデル偏重で一覧が埋まるのを防ぐ。
  const MODEL_CAP = Number(process.env.USED_MODEL_CAP) || 4;
  let scanned = 0;
  for (const c of all) {
    if (catalog.length >= TARGET) break;
    scanned++;
    const catGenre = genreOf(c.category); // このカテゴリの表示ジャンル（時計だけ上限を厚くする・netProfit/catでも再利用）
    if ((genreCount[catGenre] || 0) >= CAP_PER_GENRE) continue; // このジャンルは充足＝枠を他ジャンルへ回す（均等化）
    const cap = catGenre === "腕時計" ? CAP_WATCH : CAP_PER_CAT; // ⌚時計は CAP_WATCH まで、他は CAP_PER_CAT
    // ページ送りで在庫を深掘り（narrowなクエリは2ページ目以降が空になり次第打ち切る）。URLで重複排除。
    // 時計は在庫が厚くheadroomも大きいので深く掘る（PAGES_WATCH）。他ジャンルは PAGES。
    const maxPages = catGenre === "腕時計" ? PAGES_WATCH : PAGES;
    let items = [];
    const seenUrl = new Set();
    for (let page = 1; page <= maxPages; page++) {
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
      if (!it.imageUrl) continue; // ★画像なしは掲載しない（空カード＆出品時に写真ゼロを防ぐ）
      if (NONWATCH.test(`${it.brand} ${it.name}`)) continue; // 釣具等の非時計を除外
      if (PROHIBITED_EXCLUDE.test(`${it.brand} ${it.name}`)) continue; // 【厳命】航空危険物/国際発送不可は絶対に対象外
      // ※ジャンク(動作未確認/部品取り)も掲載対象にする（ユーザー指示2026-06-27）。出品時に状態を説明文で明示してクレーム回避。
      const ratio = it.price / c.ebayMedian;
      // ガード：仕入れがeBay中央の15〜80%（ミスマッチ＝極端に安い/高いを除外）。
      if (ratio < 0.15 || ratio > 0.8) continue;
      const net = netProfitJPY(it.price, c.ebayMedian, catGenre);
      const roi = it.price > 0 ? net / it.price : 0; // 利益率＝純利益÷仕入れ値(ROI)。配信(getUsedCatalog)と同じ定義で判定する。
      // 採用条件は「対仕入れ10%以上」だけ（純益の絶対額フロアは撤廃・ユーザー指示2026-06-28）。
      if (roi >= 0.1) {
        const idNum = (it.url.match(/\/(?:product|goodsId)\/(\d+)/) || [])[1] || it.url.replace(/\D+/g, "").slice(-12);
        const id = `used-hardoff-${idNum}`;
        if (seenId.has(id)) continue; // ★別カテゴリ検索で既出＝重複IDを作らない（同一商品が別価格で2〜3回出るのを防ぐ）
        const mkey = `${(it.brand || "").toLowerCase()}|${(it.code || it.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24)}`;
        if ((modelCount[mkey] || 0) >= MODEL_CAP) continue; // ★同一モデルは MODEL_CAP 件まで（1モデル偏重で一覧が埋まるのを防ぐ）
        catalog.push({
          id,
          modelKey: (it.code || it.name || "").slice(0, 60), brand: it.brand, name: it.name, code: it.code,
          cat: catGenre, ebayMedianJpy: c.ebayMedian, buyJpy: it.price, condition: it.condition,
          profitJpy: net, profitRate: it.price > 0 ? Math.round((net / it.price) * 100) : 0, hardoffUrl: it.url, imageUrl: it.imageUrl,
          site: "hardoff", soldCount: c.soldCount,
        });
        seenId.add(id); modelCount[mkey] = (modelCount[mkey] || 0) + 1;
        added++;
        genreCount[catGenre] = (genreCount[catGenre] || 0) + 1; // ジャンル別カウント（per-genre 上限の判定用）
        if (added >= cap || (genreCount[catGenre] || 0) >= CAP_PER_GENRE) break; // カテゴリ偏重＋ジャンル偏重の両方を防ぐ
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
  // ★psnapは「新規 or 変化した商品」だけ書く＝毎buildで全件(~1300)を再書込していたのをやめKV書込を激減（無料枠500k/月を焼き切っていた根治）。
  const psnapSig = (p) => [p.ebayMedianJpy, p.buyJpy, p.profitJpy, p.profitRate, p.imageUrl, p.ebayActiveCount, p.condition, p.soldCount, p.ebayConfirmed ? 1 : 0, p.brand, p.name].join("|");
  const prevById = new Map(); // 既存カタログの id→signature（変化判定用）
  let enriched = catalog;
  let merged = catalog;
  try {
    const existing = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
    for (const p of existing) if (p && p.id) prevById.set(p.id, psnapSig(p));
    const normCode = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // 型番→確定相場（refine済み・ebayConfirmed）の対応表。同一型番は最初の確定を採用。
    const refinedByCode = new Map();
    // 画像一致で確定したブランド品(型番なし)は code で引けない＝hardoffUrl で対応表を作る＝毎build消えるのを防ぐ。
    const refinedImgByUrl = new Map();
    for (const p of existing) {
      const k = normCode(p.code);
      if (k && p.ebayConfirmed && Number(p.ebayMedianJpy) > 0 && !refinedByCode.has(k)) refinedByCode.set(k, p);
      if (p.confirmMethod === "image" && p.ebayConfirmed && Number(p.ebayMedianJpy) > 0 && p.hardoffUrl && !refinedImgByUrl.has(p.hardoffUrl)) refinedImgByUrl.set(p.hardoffUrl, p);
    }
    let carried = 0;
    enriched = catalog.map((c) => {
      const prev = refinedByCode.get(normCode(c.code)) || refinedImgByUrl.get(c.hardoffUrl); // 型番一致を優先・無ければ画像一致(url)
      if (!prev) return c;
      const median = Number(prev.ebayMedianJpy); // 確定相場（型番一致 or 画像一致）
      const net = netProfitJPY(c.buyJpy, median, c.cat); // 仕入れは新規品の値、相場は確定値で利益を再計算
      carried++;
      return {
        ...c, ebayMedianJpy: median, profitJpy: net, profitRate: c.buyJpy > 0 ? Math.round((net / c.buyJpy) * 100) : 0, // 利益率＝純利益÷仕入れ(ROI)
        soldCount: prev.soldCount ?? c.soldCount, ebayConfirmed: true, ebayChecked: true, ebaySoldUrl: prev.ebaySoldUrl,
        ebayActiveCount: prev.ebayActiveCount ?? c.ebayActiveCount, // 競合数(=eBay現在出品総数)も引き継ぐ＝buildのたびに消えてバッジが出なくなるのを防ぐ
        // 画像一致確定の根拠も引き継ぐ（型番確定なら undefined＝JSONで自然に消える）
        confirmMethod: prev.confirmMethod, enName: prev.enName,
        matchedEbayUrl: prev.matchedEbayUrl, matchedEbayImageUrl: prev.matchedEbayImageUrl, matchedEbayTitle: prev.matchedEbayTitle,
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
  const cmds = enriched.filter((c) => c.id && (!prevById.has(c.id) || prevById.get(c.id) !== psnapSig(c))).map((c) => {
    const snap = {
      id: c.id, title: `${c.brand} ${c.name}`.trim(), imageUrl: upscaleImageflux(c.imageUrl), images: c.imageUrl ? [upscaleImageflux(c.imageUrl)] : [],
      category: c.cat || "腕時計", coreKeyword: [c.brand, c.code].filter(Boolean).join(" ").trim(), brand: c.brand, code: c.code,
      realAvgPrice: c.ebayMedianJpy, realMedianPrice: c.ebayMedianJpy, realProfit: c.profitJpy, realProfitRate: c.profitRate,
      realCount: c.soldCount || 1, soldBased: !!c.ebayConfirmed, usedCondition: c.condition,
      ebayActiveCount: c.ebayActiveCount, // 競合数(STR/競合バッジ用)。引き継いだ確定品なら入る。未取得は undefined(中立)。
      source: { site: c.site || "hardoff", siteName: c.site === "2ndstreet" ? "2nd STREET" : "ハードオフ", price: c.buyJpy, url: c.hardoffUrl },
    };
    return ["SET", `psnap:${c.id}`, JSON.stringify(snap), "EX", String(90 * 24 * 3600)];
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
