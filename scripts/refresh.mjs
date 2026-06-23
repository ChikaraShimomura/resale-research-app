#!/usr/bin/env node
// scripts/refresh.mjs — GitHub Actions バックグラウンド処理
// フロー: eBay日本発送売れ済み → 日本語KW変換 → 楽天検索 → 画像マッチ → 利益計算

// 着地コスト(国際送料手数料＋米国関税)の計算式は app と共有の SSOT を import（二重在＝ドリフトの罠を解消）。
import { landedSubtractJpy, USD_JPY as L_USD_JPY } from "../app/lib/ebay/landedCostCore.mjs";
// 危険物除外(SSOT)。発掘キーワード(EBAY_JP_QUERIES)はPixel発掘worker専用になったのでrefreshでは読まない（Phase0はebay_sold_seedを読む）。
import { PROHIBITED_EXCLUDE } from "./ebayQueries.mjs";

// ========== 設定 ==========
const RAKUTEN_APP_ID      = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY  = process.env.RAKUTEN_ACCESS_KEY;
const EBAY_APP_ID         = process.env.EBAY_APP_ID;
const EBAY_CLIENT_SECRET  = process.env.EBAY_CLIENT_SECRET;
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;
const KV_URL              = process.env.KV_REST_API_URL;
const KV_TOKEN            = process.env.KV_REST_API_TOKEN;

const USD_TO_JPY          = 155;
const GBP_TO_JPY          = 197;
const AUD_TO_JPY          = 100;
const EBAY_FEE_RATE       = 0.1325;
const EBAY_FEE_FIXED_JPY  = 47;
const SHIPPING_COST_JPY   = 0; // 送料は購入者負担

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ========== Anthropic レート制限ゲート ==========
// 実際のAPI呼び出し（キャッシュミス時のみ）の「開始」を最低 HAIKU_MIN_INTERVAL_MS 間隔に空ける。
// API遅延自体は重なる（開始だけ律速）ので、速度の天井＝1分あたりの呼び出し上限(ANTHROPIC_RPM)。
// 既定43/分＝Tier1(50RPM)の安全側。上位ティアなら refresh.yml で ANTHROPIC_RPM を実RPMの約8割に
// 上げると、件数拡大時もタイムアウト内に収まる。上げ過ぎは429→フェイルオープン(精度低下)なので注意。
const ANTHROPIC_RPM = Math.max(1, Number(process.env.ANTHROPIC_RPM) || 43);
const HAIKU_MIN_INTERVAL_MS = Math.round(60000 / ANTHROPIC_RPM);
console.log(`[rate] Anthropic ${ANTHROPIC_RPM} RPM (開始間隔 ${HAIKU_MIN_INTERVAL_MS}ms)`);
let _haikuQueue = Promise.resolve();
function haikuGate() {
  const wait = _haikuQueue;
  _haikuQueue = wait.then(() => sleep(HAIKU_MIN_INTERVAL_MS));
  return wait;
}

// ========== Upstash KV ==========
async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    if (!data.result) return null;
    try { return JSON.parse(data.result); } catch { return data.result; }
  } catch { return null; }
}

async function kvSet(key, value, exSeconds = 86400) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, JSON.stringify(value), 'EX', String(exSeconds)]]),
    });
  } catch (e) { console.error('kvSet error:', e.message); }
}

async function kvSetPermanent(key, value) {
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, JSON.stringify(value)]]),
    });
  } catch (e) { console.error('kvSetPermanent error:', e.message); }
}

// 出品アーカイブ：カタログ各商品を psnap:{id} に2年保存する。
// 利益商品カタログ(profitable_products)は入れ替わるが、仕入れた人が出品(prepare/publish)するときに
// カタログから外れていても、ここから商品データを読めるようにする＝「仕入れたのに出品できない」を防ぐ。
// カタログに居続ける商品は毎回TTLが延び、外れた商品も最後に載っていた時点から2年は出品可能。
async function kvArchiveProducts(products) {
  if (!products?.length) return;
  const TTL = String(730 * 24 * 3600); // 2年（ebay_deals/仕入れ中と揃える）
  try {
    for (let i = 0; i < products.length; i += 200) {
      const cmds = products.slice(i, i + 200).map(p => ['SET', `psnap:${p.id}`, JSON.stringify(p), 'EX', TTL]);
      await fetch(`${KV_URL}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds),
      });
    }
    console.log(`  🗄️ 出品アーカイブ(psnap)を更新: ${products.length}件（カタログ落ち後も出品可能に）`);
  } catch (e) { console.error('kvArchiveProducts error:', e.message); }
}

// ハッシュ全取得（{field: value} で返す）。restored_products(手動復活台帳)の読み出しに使う。
async function kvHgetall(key) {
  try {
    const res = await fetch(`${KV_URL}/hgetall/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const data = await res.json();
    const arr = data.result;
    if (!Array.isArray(arr)) return {};
    const obj = {};
    for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
    return obj;
  } catch { return {}; }
}

// ========== 除外パターン ==========
const EXCLUDE_PATTERN = /オリパ|ばら売り|パック売り|BOXくじ|ボックスくじ|くじ引き|ガチャ|オリジナルパック|アソート売り|\d+パック\s*(売り|のみ|セット)/i;
const ACCESSORY_EXCLUDE_PATTERN = /クリアケース|カードローダー|ローダー|カードスリーブ|スリーブ\d+枚|デッキケース|カードファイル|バインダー|カードバインダー|BOX保管|保管用|保護ケース|スタンド|ディスプレイケース|展示ケース/i;
// 互換バンド/社外ストラップ/交換部品 等の「別物アクセサリ」。純正本体を安い部品に誤マッチさせる事故を防ぐ
// （監査で腕時計の互換バンド誤マッチが多発）。純正も「バンド/ベルト」と書くため、裸の語ではなく
// “互換・社外・交換用・〇〇用ベルト・バネ棒/遊環”等のアフター品シグナルだけで弾く。
const PART_EXCLUDE = /互換|社外|交換用|交換\s*(?:ベルト|バンド|ストラップ)|替え\s*(?:ベルト|バンド|ストラップ)|汎用|バネ棒|遊環|尾錠単体|NATO\s*(?:ベルト|ストラップ|バンド)|ZULU|(?:対応|適合|用)\s*(?:ベルト|バンド|ストラップ)/i;
// 複数個セット/まとめ売り。単品のeBay出品と数量が食い違う誤マッチを防ぐ。
const SET_EXCLUDE = /\d+\s*(?:点|個|本|体|枚)\s*セット|\d+\s*(?:点|個|本|体)\s*まとめ|まとめ売り|セット売り|\d+\s*個入り|詰め合わせ/i;
// プライズ/景品/一番くじ等の非プレミアム品。可動S.H.Figuartsやスケール品と誤マッチしやすいので、フィギュアでは除外する。
const PRIZE_RE = /プライズ|景品|一番くじ|一番クジ|アミューズメント|クレーンゲーム|ナムコ限定|セガ限定|ラッキーくじ|みんなのくじ/i;
// 中古/ユーズド/ジャンク。新品eBay相場と比較すると利益が過大に見える誤検知の温床（精度監査で確認）。
// 初心者向け・低リスク方針に合わせ、中古の楽天品はカタログから除外する。detectCondition と同じ語で判定。
const USED_EXCLUDE = /中古|ユーズド|used|ジャンク/i;
// 予約・発売前・受注/取り寄せ等「今すぐ手元に無く海外に即発送できない」商品。中古と同列で対象外。
// （発売日に届く保証が無く、eBay落札→即発送のフローが崩れるため。再入荷すれば次回refreshで再登録される）
const PREORDER_EXCLUDE = /予約|ご予約|発売予定|発売前|入荷予定|お取り寄せ|取り寄せ|受注生産|受注販売/i;
// PROHIBITED_EXCLUDE(危険物)は ./ebayQueries.mjs に分離＝Pixel発掘workerと共有(SSOT)。上の import を参照。

// タイトルから「数量(個数)」を推定する。既定1。楽天が複数パック/セットなのにeBay単品と比較され
// 価格(=利益)が狂う事故を防ぐ。ml/g等の単位・型番・版数(Ver.2/No.264)は数量と誤認しない設計。
function quantityOf(title) {
  const s = title || "";
  let q = 1;
  const bump = (n) => { const v = parseInt(n, 10); if (v >= 2 && v <= 50) q = Math.max(q, v); };
  let m;
  // 日本語: 数字 + 個数カウンタ（個/本/点/枚/コ/ヶ/組/袋/箱/パック/セット）。「N個入り」「Nセット」も含む。
  const jp = /(\d{1,2})\s*(?:個|本|点|枚|コ|ヶ|組|袋|箱|パック|セット)/g;
  while ((m = jp.exec(s))) bump(m[1]);
  if (/(?:^|[^ァ-ヶー])ペア(?![ンミ])/.test(s)) q = Math.max(q, 2); // ペア=2（ペイント/ペンは除外）
  // 英語(eBay): lot of N / set of N / pack of N / N pcs / N pieces / N-pack
  const en = /(?:lot|set|pack)\s*of\s*(\d{1,2})|(\d{1,2})\s*(?:pcs|pieces|[- ]pack)\b/gi;
  while ((m = en.exec(s))) bump(m[1] || m[2]);
  // ×N（掛け算の数量。寸法[150x150]誤検出を避け 2〜20 に限定）
  const x = /[×x]\s*([2-9]|1\d|20)\b/gi;
  while ((m = x.exec(s))) bump(m[1]);
  return q;
}
// ① 楽天検索のNGKeyword（除外語）。社外/互換/部品/アクセサリ/シール等の別物を“拾う前に”除外。
//   ※「バンド/ベルト」単体は純正時計名にも出るため入れない(recall維持)。バンド誤マッチは価格比とPART_EXCLUDEで対処。
const NG_KEYWORDS = '互換 社外 交換用 汎用 スリーブ ローダー 保護フィルム バネ棒 遊環 シール ステッカー';
// ② eBay種ジャンル(EBAY_JP_QUERIESのname) → 期待する楽天側ジャンル(guessCategory)。明確な別ジャンル混入を弾く。
const EXPECTED_GENRE = {
  'ポケモンカード': 'トレカ', '遊戯王': 'トレカ', 'ワンピースカード': 'トレカ',
  'ガンプラMG': 'ガンプラ', 'ガンプラHG': 'ガンプラ', 'ねんどろいど': 'フィギュア',
  'LEGO': 'LEGO', 'セイコー': '腕時計', 'Gショック': '腕時計', '資生堂': 'コスメ',
  'トミカ': 'おもちゃ', 'アミーボ': 'ゲーム',
  // recall拡張ぶん。値は guessCategory の実測出力に合わせる（誤った別ジャンル除外で良マッチを落とさないため）。
  // ※amiiboカード=ゲーム / METAL BUILD=ガンプラ(ガンダム判定) / ポケセンぬいぐるみ=トレカ(ポケモン判定) は実測で補正。
  'DBフュージョンワールド': 'トレカ', 'ヴァイス ホロライブ': 'トレカ', 'デジモンカード': 'トレカ',
  'どうぶつの森amiiboカード': 'ゲーム',
  'ガンプラRG': 'ガンプラ', 'ガンプラPG': 'ガンプラ', 'ガンプラEG': 'ガンプラ', '30MM ACVI': 'ガンプラ',
  'SHFドラゴンボール': 'フィギュア', 'SHF鬼滅': 'フィギュア', 'figma': 'フィギュア', 'POP UP PARADE': 'フィギュア',
  'METAL BUILD': 'ガンプラ', 'メガミ/FAガール': 'フィギュア',
  'オシアナス': '腕時計', 'アテッサ': '腕時計', 'オリエント バンビーノ': '腕時計',
  'アネッサ': 'コスメ', 'ハダラボ極潤': 'コスメ', 'キャンメイク': 'コスメ', 'SK-II': 'コスメ',
  'ベイブレードX': 'おもちゃ', 'ミニ四駆': 'おもちゃ', 'ポケセンぬいぐるみ': 'トレカ',
  // ── バッチ1拡張(2026-06-17): 100件@98%へ。Switch系は guessCategory が「ゲーム機」を返すため値もゲーム機。
  //    その他(ちいかわ/TFマスターピース/超合金魂)は意図的に未登録＝ジャンル整合ゲートをskip(設計どおり)。
  'ポケカ151': 'トレカ', 'ポケカETB': 'トレカ', 'ポケカハイクラス': 'トレカ', '遊戯王ストラク': 'トレカ', 'ワンピーススタートデッキ': 'トレカ', 'ユニオンアリーナ': 'トレカ',
  'SHF悟空': 'フィギュア', 'SHFルフィ': 'フィギュア', 'SHFナルト': 'フィギュア', 'SHF仮面ライダー': 'フィギュア', 'ねんどミク': 'フィギュア', 'GSC1/7スケール': 'フィギュア',
  'GショックGA2100': '腕時計', 'GショックDW5600': '腕時計', 'セイコー5SRPD': '腕時計', 'セイコープロスペックスSRPE': '腕時計',
  'スプラ3SW': 'ゲーム機', 'ゼノブレ3SW': 'ゲーム機',
  // 腕時計 手厚く拡張(2026-06-23)。全て guessCategory→'腕時計'(Seiko/Casio/Citizen/Orient/Watch/腕時計 で判定)。
  'セイコープレザージュ': '腕時計', 'プロスペックスサムライ': '腕時計', 'プロスペックスアルピニスト': '腕時計',
  'プロスペックススピードタイマー': '腕時計', 'セイコー5GMT': '腕時計', 'セイコーセレクション': '腕時計',
  'カシオエディフィス': '腕時計', 'カシオプロトレック': '腕時計', 'GショックGWM5610': '腕時計', 'Gショックマッドマスター': '腕時計',
  'シチズンプロマスター': '腕時計', 'シチズンTSUYOSA': '腕時計', 'シチズンシリーズ8': '腕時計',
  'オリエントスター': '腕時計', 'オリエントカマス': '腕時計', 'オリエントマコ': '腕時計',
  // Tier1拡張(2026-06-23)。TCG→トレカ / フィギュア追加→フィギュア / Switch→ゲーム機。
  // プラモ/鉄道模型/ダイキャスト/万年筆/キャラ雑貨/ReFa は意図的に未登録＝ジャンル整合ゲートをskip(画像AIで判定・既存その他系と同方針)。
  'MTG日本語': 'トレカ', 'ヴァンガード': 'トレカ', 'デュエマ': 'トレカ', 'バトスピ': 'トレカ', 'シャドバエボルヴ': 'トレカ', 'ポケカSV': 'トレカ', 'ワンピOPブースター': 'トレカ', '遊戯王QC': 'トレカ',
  'ROBOT魂': 'フィギュア', 'MAFEX': 'フィギュア', 'ARTFX': 'フィギュア', 'フィギュアーツZERO': 'フィギュア', 'リボルテック': 'フィギュア', 'リーメント': 'フィギュア', 'ねんどろいどどーる': 'フィギュア', '超合金GX': 'フィギュア',
  'ゼルダTOTK': 'ゲーム機', 'マリオワンダー': 'ゲーム機', 'ポケモンSVソフト': 'ゲーム機', 'スマブラSP': 'ゲーム機', 'マリカ8DX': 'ゲーム機',
};
// ⑤ 価格比サニティの上限（eBay最安 > 楽天価格 × この倍率 → 安い部品×高い本体等の誤マッチ疑いで除外）。
const PRICE_RATIO_MAX = 8;
// 利益率(%)の下限。これ以下は一覧に出さない（ユーザー指定: 10%以下は除外）。新規・既存の両方に適用。
const PROFIT_RATE_FLOOR = 10;

// ===== 着地コストは app/lib/ebay/landedCostCore.mjs に一本化（SSOT・app と共有・上部で import 済み）=====
// 「利益商品」の判定を“ネット利益率”（国際送料にかかるeBay手数料＋米国関税を引いた後）で行う。
// 粗利フロアだけだとネット<10%が利益商品に混じるため、最終保存の直前にネット利益率でも10%以下を除外する。
function netProfitRate(p) {
  const valueUsd = (p.realAvgPrice || 0) / L_USD_JPY;
  // ポイントは利益に含めない＝原価から引かず、realProfit からも足し戻して現金純利益で判定（配信 displayProfit と一致）。
  const point = p.source?.pointAmount ?? 0;
  const cashBuy = (p.source?.price ?? 0) + (p.source?.shippingJpy ?? 0);
  const net = Math.round((p.realProfit ?? 0) - point - landedSubtractJpy(p.category, valueUsd));
  return cashBuy > 0 ? Math.round((net / cashBuy) * 100) : 0;
}

// ========== eBayクエリハッシュ ==========
function ebayQueryHash(query) {
  let h = 0;
  for (const c of query) { h = Math.imul(31, h) + c.charCodeAt(0) | 0; }
  return Math.abs(h).toString(36);
}

// ========== 利益計算 ==========
function calcProfit(rakutenPrice, ebayAvgJpy, pointAmount, domesticShipJpy = 0) {
  // 原価 = 楽天価格 + 国内送料(ショップ→自分) - 獲得ポイント。ポイントは商品代に対して付くので送料には掛けない。
  const effectiveBuy = rakutenPrice + domesticShipJpy - pointAmount;
  if (effectiveBuy <= 0) return { profit: 0, profitRate: 0 };
  const ebayFee = Math.round(ebayAvgJpy * EBAY_FEE_RATE) + EBAY_FEE_FIXED_JPY;
  const profit = ebayAvgJpy - effectiveBuy - ebayFee - SHIPPING_COST_JPY;
  return { profit, profitRate: Math.round((profit / effectiveBuy) * 100) };
}

// ========== 仕入れ元(楽天)の実ページ照合 ==========
// 楽天 Item Search API の availability/itemPrice は当てにならない：
//   ・売り切れでも availability≠0 を返すことがある（→カタログに売切が残り、出品後に欠品事故）。
//   ・複数タイプ(例 5パック/10パック/1箱)の商品は「最安価格」しか返さない（→最安を1箱の原価と誤認＝利益過大）。
// 実ページの schema.org(availability / lowPrice / highPrice)は ASCII なのでページの文字コードに関係なく読める。
const SOURCE_RANGE_RATIO = 1.3;        // highPrice/lowPrice がこれ以上＝原価が一意に決まらない複数タイプとみなす
const SOURCE_RECONCILE_GAP_MS = 350;   // 楽天への礼儀（checkLinks/diagDcProbe に倣いバースト遮断を避ける）
const SOURCE_RECONCILE_CONC = 3;
const SOURCE_RECONCILE_MIN_KEEP = 0.6; // 照合後の残存がこれ未満＝取得異常を疑い結果を破棄(systemic false-positive ブレーキ)
function realRakutenUrl(srcUrl) {
  if (!srcUrl) return null;
  const s = String(srcUrl);
  // 楽天アフィリ中継(hb.afl.rakuten.co.jp)のときだけ ?pc=<直URL> を取り出す（誤抽出防止のホストガード）
  if (/hb\.afl\.rakuten\.co\.jp/.test(s)) {
    const m = s.match(/[?&]pc=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  }
  if (s.includes('item.rakuten.co.jp')) return s; // 直リンク
  return null; // 番号URL(/{shop}/{itemCode番号}/)は404になるので組み立てない
}
function parsePriceNum(s) { const n = Number(String(s ?? '').replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; }
async function fetchSourceSchema(srcUrl) {
  const url = realRakutenUrl(srcUrl);
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (res.status === 429 || res.status === 503) return { blocked: true };       // レート制限/一時拒否＝以降打ち切り
    if (!res.ok) return null;                                                      // 取得不可＝fail-open(現状維持)
    // ※リダイレクト先ドメインで死活を推定しない：楽天ブックス品は item.rakuten.co.jp/book/… が
    //   books.rakuten.co.jp/… へ正規リダイレクトする(在庫あり)ため誤除外になる。閉店/リンク切れの
    //   死活判定は既存 checkLinks.mjs の担当。ここは「売切(OutOfStock)」と「価格レンジ」だけ正確に見る。
    const html = await res.text();
    // 価格と在庫は主商品Offerのmicrodata(lowPrice/highPrice/availability)から取る。関連商品(recommend)枠には
    // これらの itemprop が無いため主商品スコープになる。属性順/引用符/カンマ入り数値に強い形で拾う。
    const lowPrice = parsePriceNum(html.match(/itemprop=["']lowPrice["'][^>]*content=["']?([\d,]+)/i)?.[1]);
    const highPrice = parsePriceNum(html.match(/itemprop=["']highPrice["'][^>]*content=["']?([\d,]+)/i)?.[1]);
    const availability = html.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)/i)?.[1] || '';
    return { soldOut: /OutOfStock|SoldOut|Discontinued/i.test(availability), lowPrice, highPrice };
  } catch { return null; }
}
// finalists を実ページで照合：①OutOfStock/削除は除外 ②価格レンジ大は箱(highPrice)で原価再計算（不採算なら除外）。
// fail-open：ページ取得できなければ現状維持。systemicブレーキ：大量除外は取得異常とみなし丸ごと破棄。
async function reconcileSourcePages(products) {
  const out = new Array(products.length);
  const overpricedIds = []; // 箱価格(複数タイプ)で原価誤認＝不採算で除外したID。eBay出品の自動停止に使う
  let idx = 0, dropped = 0, repriced = 0, blocked = false;
  async function worker() {
    while (idx < products.length) {
      const i = idx++;
      const p = products[i];
      if (blocked) { out[i] = p; continue; }                         // ブレーキ後は触らない(fail-open)
      const info = await fetchSourceSchema(p?.source?.url);
      await sleep(SOURCE_RECONCILE_GAP_MS);
      if (!info) { out[i] = p; continue; }                           // 取得不可＝現状維持(fail-open)
      if (info.blocked) { blocked = true; out[i] = p; continue; }    // 429/503＝以降打ち切り
      if (info.soldOut) { out[i] = null; dropped++; continue; }      // 実ページ売切/削除＝カタログから除外
      if (info.lowPrice && info.highPrice && info.highPrice / info.lowPrice >= SOURCE_RANGE_RATIO) {
        const price = info.highPrice;                                // 複数タイプ＝最安でなく箱(高い方)を原価に
        const pointRate = p.source?.pointRate ?? 1;
        const pointAmount = Math.floor(price * pointRate / 100);
        const r = calcProfit(price, p.realAvgPrice, pointAmount, p.source?.shippingJpy ?? 0);
        if (r.profitRate <= PROFIT_RATE_FLOOR) { out[i] = null; dropped++; overpricedIds.push(p.id); continue; } // 箱原価では利益出ず＝除外（出品中があればeBayも停止）
        out[i] = { ...p, source: { ...p.source, price, pointAmount }, realProfit: r.profit, realProfitRate: r.profitRate };
        repriced++;
      } else {
        out[i] = p;
      }
    }
  }
  await Promise.all(Array.from({ length: SOURCE_RECONCILE_CONC }, worker));
  if (blocked) { console.log('  ⚠️ 実ページ照合: 楽天が429/503を返したため打ち切り（fail-open＝カタログ現状維持）'); return products; }
  const kept = out.filter(Boolean);
  // systemic false-positive ブレーキ：取得異常(200のインタースティシャル/地域ブロック等)で大量除外したら丸ごと破棄。
  // 既存のeBay最安再評価の「>85%落ちたら見送り」ブレーキと同思想（無音の自滅を防ぐ）。
  if (products.length >= 10 && kept.length / products.length < SOURCE_RECONCILE_MIN_KEEP) {
    console.log(`  ⚠️ 実ページ照合: 除外が多すぎ(${products.length}→${kept.length})＝取得異常を疑い結果を破棄(fail-open)`);
    return products;
  }
  // 箱価格で不採算の商品IDをグローバルに記録（正常完了時のみ全置換＝復活した商品は自動で外れる）。
  // auto-stop-cron / reconcile が消費し、出品中があればeBayから自動停止する（「除外時はeBay停止も」の配線）。
  try { await kvSet('catalog_overpriced_ids', overpricedIds, 480 * 3600); } catch (e) { console.error('catalog_overpriced_ids write error:', e.message); }
  console.log(`  🔎 仕入れ元実ページ照合: 売切/不採算で除外 ${dropped}件(うち箱価格不採算 ${overpricedIds.length}件)・複数タイプを箱価格で再計算 ${repriced}件 → 残 ${kept.length}件`);
  return kept;
}

// 国内送料(楽天ショップ→自分)の概算。送料込み(postageFlag=0)は0。
// 楽天APIは正確な送料額を返さないため、カテゴリの典型サイズで保守的に概算する（過小利益＝安全側）。
// 送料別の商品はこの分だけ利益が下がり、閾値割れすれば落ちる＝より正直な利益表示になる。
const DOMESTIC_SHIP_JPY = {
  'トレカ': 350, 'コスメ': 500, 'ゲーム': 400, 'フィギュア': 800, 'ガンプラ': 800,
  'LEGO': 1000, '腕時計': 600, 'ゲーム機': 1100, 'カメラ': 1000, 'おもちゃ': 700, 'その他': 700,
};
function domesticShipping(category, postageFlag, title) {
  // 楽天の商品検索APIは「正確な送料額」を返さない（postageFlag=送料込み(0)/送料別(1)のみ。金額フィールド無し）。
  // 正確に算出: 送料無料/込みが明示 or postageFlag=0 → ¥0。送料別(=1)はカテゴリ別の概算(APIに正確な額が無いため)。
  if (/送料無料|送料込/.test(title || '')) return 0;
  if (Number(postageFlag) === 0) return 0;
  return DOMESTIC_SHIP_JPY[category] ?? 700;
}

// ========== カテゴリ推定 ==========
// 注意: 単独の MG/HG/RG/PG は「資生堂MG5」等を誤ってガンプラ判定するため必ず \b で囲む。
// また「クレンズ」が /レンズ/ にマッチしてカメラ誤判定になるため、コスメ・美容を先に判定する。
function guessCategory(title) {
  const t = title || '';
  // コスメ・美容を先に（資生堂MG5・専科クレンズ等の誤判定を防ぐ）
  if (/コスメ|香水|スキンケア|資生堂|花王|ランコム|シャネル|専科|アネッサ|ウーノ|\bUNO\b|イハダ|MG5|エムジー5|化粧水|乳液|美容液|洗顔|クレンジング|日焼け止め|\bSPF|ボディミルク|ハンドクリーム|キャンメイク|CANMAKE|SK-?II|SK-?2\b|SKII|肌ラボ|ハダラボ|チーク|ファンデ|化粧下地|フィニッシュパウダー/i.test(t)) return 'コスメ';
  if (/ポケモン|遊戯王|デュエルマスターズ|トレカ|カードゲーム|ワンピースカード|カードバトル|ギャザリング|MTG|ヴァンガード|ヴァイス|バトルスピリッツ|バトスピ|シャドウバース/i.test(t)) return 'トレカ';
  if (/ガンプラ|ガンダム|\bMG\b|\bHG\b|\bRG\b|\bPG\b|1\/100|1\/144|BANDAI SPIRITS|30MM|30 ?MINUTES/i.test(t)) return 'ガンプラ';
  if (/LEGO|レゴ/i.test(t)) return 'LEGO';
  if (/フィギュア|ねんどろいど|Nendoroid|figma|プライズ|グッドスマイル|GOOD SMILE|S\.?H\.?\s?Figuarts|フィギュアーツ|POP UP PARADE|超合金|ROBOT魂|ROBOT SPIRITS|MAFEX|ARTFX|リボルテック|リーメント|Re-?ment/i.test(t)) return 'フィギュア';
  if (/Nintendo Switch|PS5|PlayStation|Xbox/i.test(t)) return 'ゲーム機';
  if (/amiibo|アミーボ|ゲームソフト/i.test(t)) return 'ゲーム';
  if (/腕時計|Watch|Seiko|セイコー|Citizen|シチズン|Casio|カシオ|Gショック|G-SHOCK|Orient|オリエント|プロスペックス|Prospex|プレザージュ|Presage|プロマスター|Promaster|エディフィス|Edifice|プロトレック|Pro\s?Trek/i.test(t)) return '腕時計';
  if (/カメラ|レンズ|Canon|Nikon|Fujifilm|一眼レフ/i.test(t)) return 'カメラ';
  if (/トミカ|プラレール|シルバニア|ベイブレード|BEYBLADE/i.test(t)) return 'おもちゃ';
  return 'その他';
}

// eBayタイトルが「汎用的すぎる」(型番・固有名がほぼ無い)か判定。
// 例: "BANDAI Plastic Model Gunpla MASTER GRADE Preowned" → true（キット名が無い）。
// これが true の商品は coreKeyword を楽天タイトルの英訳に差し替え、検索で同じ商品が出やすくする。
const KW_GENERIC = new Set([
  'bandai', 'spirits', 'plastic', 'model', 'kit', 'gunpla', 'master', 'grade', 'high', 'figure',
  'nintendo', 'japan', 'japanese', 'new', 'sealed', 'unopened', 'preowned', 'used', 'official',
  'authentic', 'genuine', 'import', 'imported', 'limited', 'edition', 'rare', 'set', 'lot', 'toy',
  'collectible', 'collection', 'anime', 'game', 'the', 'and', 'for', 'with',
]);
function isWeakKeyword(title) {
  const toks = (title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  if (toks.some(t => /\d/.test(t))) return false;            // 型番・番号があれば特定できる＝弱くない
  const distinct = toks.filter(t => t.length >= 3 && !KW_GENERIC.has(t));
  return distinct.length < 2;                                // 固有名がほぼ無い＝汎用
}

// カード番号・型番の抽出（ST13-002 / P-028 / DW-5600E / GWG-1000-1A3 等）。年号や容量の裸数字は拾わない。
// 数字直後の「くっついた英字サフィックス」も拾う（DW-5600E と DW-5600F を別物として区別するため）。
function extractCodes(s) {
  const up = (s || '').toUpperCase();
  const m = up.match(/\b[A-Z]{1,4}-?\d{1,4}[A-Z]{0,2}(?:[-/][A-Z0-9]{1,6})*\b/g) || [];
  return [...new Set(
    m.filter(c => /\d/.test(c) && (/[-/]/.test(c) || /[A-Z]{2,}\d/.test(c) || /\d[A-Z]/.test(c)))
      .map(c => c.replace(/[^A-Z0-9]/g, ''))
  )];
}
// 2つのタイトルの番号が食い違う＝別商品の誤マッチ（同キャラ別番号カード等）。
// 前方一致は同型のサブ変種(GWG-1000 ⊂ GWG-1000-1A3)として許容。どちらかに番号が無ければ判定しない。
function codesConflict(a, b) {
  const ca = extractCodes(a), cb = extractCodes(b);
  if (!ca.length || !cb.length) return false;
  return !ca.some(x => cb.some(y => x === y || x.startsWith(y) || y.startsWith(x)));
}

// 相場用：比較品をアンカー(画像照合済み)と同一商品に絞る判定。
// null=どちらかに型番が無い(=判定保留＝残す。型番を省いた安い同一品を消さないため)。
// true=型番が一致(前方一致含む・同サブ変種は同一扱い)／false=両方に型番ありで一致なし(=別物・落とす)。
function priceCodeCompat(anchorTitle, compTitle) {
  const a = extractCodes(anchorTitle), c = extractCodes(compTitle);
  if (!a.length || !c.length) return null;
  return a.some(x => c.some(y => x === y || x.startsWith(y) || y.startsWith(x)));
}
// 容量/スケールの抽出（200ml / 1/7 等）。相場の別容量・別スケール混入を弾くのに使う。
function extractSize(s) {
  const t = (s || '').toLowerCase();
  const vol = (t.match(/\b\d+(?:\.\d+)?\s?(?:ml|g|kg|l|cm|mm|inch|")\b/g) || []).map(x => x.replace(/\s/g, ''));
  const scale = (t.match(/\b1\/\d{1,2}\b/g) || []);
  return { vol, scale };
}
// 容量orスケールが両方にあって一致しなければ別物（型番が無い商品＝コスメ/フィギュア等の保険）。
function sizeMismatch(a, b) {
  const A = extractSize(a), B = extractSize(b);
  if (A.vol.length && B.vol.length && !A.vol.some(x => B.vol.includes(x))) return true;
  if (A.scale.length && B.scale.length && !A.scale.some(x => B.scale.includes(x))) return true;
  return false;
}

// ========== 楽天商品取得 ==========
async function fetchRakutenPage(keyword, page) {
  const params = new URLSearchParams({
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    hits: '30',
    page: String(page),
    sort: '-reviewCount',
    format: 'json',
    minPrice: '1000',
    maxPrice: '100000',
    keyword,
    NGKeyword: NG_KEYWORDS, // ① 社外/互換/部品/アクセサリ等を検索段階で除外
  });
  try {
    const res = await fetch(
      `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401?${params}`,
      {
        headers: {
          Referer: 'https://www.yushutsu-fukugyo.com/',
          Origin: 'https://www.yushutsu-fukugyo.com',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];
    return (await res.json()).Items ?? [];
  } catch { return []; }
}

// ========== 画像マッチ（ジャンル別・識別子重視 / Claude一本化: Haiku下調べ＋Sonnet確認） ==========
// 別変種(同キャラ別番号・同機体別グレード・同ライン別容量・正規vs互換 等)をSAMEと誤る偽陽性が相場/利益を狂わせる。
// 対策: 画像を高解像度化＋タイトル文脈＋識別子を読ませる保守プロンプト。実画像検証で旧プロンプトの偽陽性3→0・取りこぼし0。
// 【合議】A(下調べ): 安価な Haiku で判定。NOなら即除外。B(確認): HaikuがYESの候補だけ上位の Sonnet で確認し、
//   両方YESの時だけ採用＝偽陽性を上位モデルで潰す。AIベンダーは Anthropic に一本化（Gemini廃止）。
let haikuCallsToday = 0;
let sonnetCallsToday = 0;
let haikuFailToday = 0; // 観測フック: Haiku不通(Anthropic到達不可)の回数。全滅時は未検証で商品が通る(fail-open)ため要警戒。
// Sonnet確認の実行あたり上限回数（巨大リビルド時のコスト暴走を防ぐブレーキ）。既定300=通常運用は常に確認。
// 最小コストで回したい時は IMG_MATCH_SONNET_BUDGET=0 で Haiku 単独運用に落とせる。
const MAX_SONNET_PER_RUN = Number(process.env.IMG_MATCH_SONNET_BUDGET ?? 300);

// 相場の「最安」を決める比較品の画像照合（有料）の予算。最安がアンカーよりかなり安い(=別の安い商品の疑い)
// 時だけ発火。1商品あたり PRICE_VERIFY_PER_ITEM 件まで・1実行 PRICE_VERIFY_BUDGET 件まで（コスト上限）。
const PRICE_VERIFY_BUDGET = Number(process.env.PRICE_VERIFY_BUDGET ?? 150);
const PRICE_VERIFY_PER_ITEM = Number(process.env.PRICE_VERIFY_PER_ITEM ?? 4);
let priceVerifyToday = 0;

// 楽天サムネは _ex=128x128 等で型番/容量の文字が読めない→拡大。eBayの s-l{N} も大判化。
function upscaleRakuten(url) { return (url || '').replace(/_ex=\d+x\d+/, '_ex=600x600'); }
function upscaleEbay(url) { return (url || '').replace(/s-l\d{2,4}/i, 's-l800'); }

// 識別子重視・保守的な厳密判定プロンプト（カテゴリ別ルール＋識別子が読めなければLOW=reject）。
function strictMatchPrompt(rakutenTitle, ebayTitle, qty) {
  return `You verify whether two photos show the EXACT SAME sellable product variant, for a resale price catalog. A wrong "same" misleads users about market price, so be conservative: if you cannot confirm the same specific variant, answer NO.
Image 1: Rakuten (Japan). Title: "${(rakutenTitle || '').slice(0, 140)}".${qty ? ` Quantity: ${qty}.` : ''}
Image 2: eBay. Title: "${(ebayTitle || '').slice(0, 140)}".
Step 1 - For EACH image, read every identifier from the image AND its title: product/character name, series, model or card number, edition/version, color, size/volume, dosage form, quantity.
Step 2 - Compare the SPECIFIC variant, not just the category:
 - Figures/amiibo/plush: same CHARACTER and version. Same series but different character = NO.
 - Trading cards: the card NUMBER and the specific card must match. Different number/rarity/edition (1st vs unlimited) = NO.
 - Model kits (Gunpla): same kit AND grade (HG/RG/MG/PG) AND version (Ver.x.x). Different grade/version = NO.
 - Cosmetics/consumables: same product line, same dosage form (lotion/milk/cream/serum), AND same size/volume (e.g. 80g vs 90g). Any difference = NO.
 - Watches/accessories: a genuine branded item is NOT the same as a generic/compatible/aftermarket item. Only treat as genuine if the titles/model numbers agree; never declare genuine from the image alone.
 - Quantity: single vs set/lot/box/bundle must match.
Step 3 - If a distinguishing identifier (grade/volume/number/edition) cannot be read in EITHER the image or the title, do NOT guess YES; set CONFIDENCE: LOW.
Reply EXACTLY in this format:
ID1: <the specific variant in image 1>
ID2: <the specific variant in image 2>
SAME_VARIANT: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}

// 【#6 確信ゲート】Sonnet確認用の「反証する」プロンプト。HaikuがYESと言った候補を、あえて別物の証拠を探して潰す。
// 監査(audit_catalog)で 文字盤色違い/別セット/曖昧figma を捕捉できた敵対的判定を、本番の最終ゲートに組み込む。
function adversarialMatchPrompt(rakutenTitle, ebayTitle, qty) {
  return `You are an adversarial QA auditor confirming a Japan→eBay resale match for a price catalog. Two photos are shown.
Image 1: Rakuten (Japan). Title: "${(rakutenTitle || '').slice(0, 140)}".${qty ? ` Quantity: ${qty}.` : ''}
Image 2: eBay. Title: "${(ebayTitle || '').slice(0, 140)}".
Your job is to find ANY reason these are NOT the exact same sellable product variant. Be skeptical; the default is NO. A wrong "same" misleads users about price.
REJECT (answer NO) on any mismatch of: product/character name, series, model number, card number, set/expansion, edition/version, grade (HG/RG/MG/PG), dial or color, size/volume (ml,g), dosage form. A genuine item is NOT a compatible/aftermarket part. A single is NOT a set/box/lot. An accessory (case/sleeve/stand) is NOT the product itself.
If a distinguishing identifier (number/grade/volume/color/edition) cannot be CONFIRMED in BOTH the image and the title, do NOT assume same — set CONFIDENCE: LOW.
Reply EXACTLY in this format:
ID1: <the specific variant in image 1>
ID2: <the specific variant in image 2>
SAME_VARIANT: YES/NO
CONFIDENCE: HIGH/MEDIUM/LOW
REASON: <short>`;
}

// Anthropic ビジョン呼び出し（2画像）。失敗時 null。共通レートゲートを通す。
async function anthropicVision(model, maxTokens, promptText, img) {
  await haikuGate();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens, temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: promptText },
        { type: 'image', source: { type: 'base64', media_type: img.mt1, data: img.b1 } },
        { type: 'image', source: { type: 'base64', media_type: img.mt2, data: img.b2 } },
      ]}],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}

// strictMatchPrompt の応答を「同一(YES)かつ確信がLOWでない」かで判定。
function parseStrictSame(text, requireHigh = false) {
  if (!/SAME_VARIANT:\s*YES/i.test(text) || /CONFIDENCE:\s*LOW/i.test(text)) return false;
  // 確信ゲート: コスメ/フィギュア等は MEDIUM も除外し HIGH のみ採用（世代/バリエ/容量違いの曖昧マッチを落とす）。
  if (requireHigh && !/CONFIDENCE:\s*HIGH/i.test(text)) return false;
  return true;
}

// Haiku で同一判定（下調べ・主軸）。識別子重視プロンプト。true/false、キー無し・失敗時 null。
async function haikuStrict(img, rakutenTitle, ebayTitle, qty) {
  if (!ANTHROPIC_API_KEY) return null;
  const t = await anthropicVision('claude-haiku-4-5', 220, strictMatchPrompt(rakutenTitle, ebayTitle, qty), img);
  if (t === null) return null;
  haikuCallsToday++;
  return parseStrictSame(t);
}

// Sonnet で同一判定（上位モデルでの確認用）。HaikuがYESと言った候補だけに使う。true/false、失敗時 null。
async function sonnetStrict(img, rakutenTitle, ebayTitle, qty, requireHigh = false) {
  if (!ANTHROPIC_API_KEY) return null;
  // #6: Sonnet確認は「反証する」プロンプトで実施＝確信ゲート。LOW/反証ありは parseStrictSame で false→除外。
  // requireHigh のジャンル(コスメ/フィギュア)は HIGH のみ採用。
  const t = await anthropicVision('claude-sonnet-4-6', 220, adversarialMatchPrompt(rakutenTitle, ebayTitle, qty), img);
  if (t === null) return null;
  sonnetCallsToday++;
  return parseStrictSame(t, requireHigh);
}

async function isImageMatch(rakutenUrl, ebayUrl, opts = {}) {
  if (!rakutenUrl || !ebayUrl) return true;
  // strict=true(コスメ/フィギュア): Sonnetの確信HIGHが取れた時だけ採用。確認できない(不通/予算切れ)なら採用しない＝確信ゲート。
  const { rakutenTitle = '', ebayTitle = '', rakutenQuantity = null, strict = false } = opts;

  // キャッシュキーを v3 に更新。旧 img_match2 は「壊れたGemini→Haiku単独」時代の判定なので無効化し、
  // 新しい Haiku下調べ→Sonnet確認 の合議で全ペアを判定し直させる（BOX≠単品 等の取りこぼしを洗浄）。
  const cacheKey = `img_match5:${ebayQueryHash(rakutenUrl + ebayUrl)}`; // v5: コスメ/フィギュアの確信HIGHゲート導入→再処理時に再判定させる(v4の暫定一致を無効化)
  const cached = await kvGet(cacheKey);
  if (cached !== null) return cached === true || cached === 'true';

  // 画像は一度だけ高解像度で取得（文字＝識別子を読めるように）。
  let img;
  try {
    const [r1, r2] = await Promise.all([
      fetch(upscaleRakuten(rakutenUrl), { signal: AbortSignal.timeout(6000) }),
      fetch(upscaleEbay(ebayUrl), { signal: AbortSignal.timeout(6000) }),
    ]);
    if (!r1.ok || !r2.ok) return true; // 取得不可は判定不能→従来通りfail-open（商品を不当に落とさない）
    const [a1, a2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
    img = {
      b1: Buffer.from(a1).toString('base64'), mt1: r1.headers.get('content-type') ?? 'image/jpeg',
      b2: Buffer.from(a2).toString('base64'), mt2: r2.headers.get('content-type') ?? 'image/jpeg',
    };
  } catch { return true; }

  // ===== Claude一本化: Haiku下調べ → Sonnet確認 =====
  // A(下調べ): 安価な Haiku で識別子判定。NOなら即除外。null(Anthropic不通)は保留=fail-open（商品を不当に落とさない）。
  // B(確認): HaikuがYESの候補だけ、上位の Sonnet で確認。両方YESの時だけ採用＝偽陽性を上位モデルで潰す。
  try {
    const hai = await haikuStrict(img, rakutenTitle, ebayTitle, rakutenQuantity);
    if (hai === null) { haikuFailToday++; return true; }  // Anthropic不通→保留(キャッシュしない=次回再評価)
    if (hai === false) {                            // Haikuが別物→確定で除外
      await kvSet(cacheKey, false, 720 * 3600);
      return false;
    }

    // hai === true。B: Sonnetで確認（誤検知を上位モデルで潰す）。strict は HIGH のみ採用。
    if (sonnetCallsToday < MAX_SONNET_PER_RUN) {
      const son = await sonnetStrict(img, rakutenTitle, ebayTitle, rakutenQuantity, strict);
      if (son === null) {                           // Sonnet不通
        if (strict) return false;                   // コスメ/フィギュア: 確認不能なら採用しない(キャッシュせず=復旧後に再評価)
        await kvSet(cacheKey, true, 24 * 3600);     // 通常: Haiku単独で短期採用
        return true;
      }
      if (son === false) console.log('  [img NG/Sonnet否決]');
      await kvSet(cacheKey, son, 720 * 3600);
      return son;
    }

    // Sonnet予算切れ。strict は採用しない(確信ゲート優先)。通常は Haiku単独で短期採用＋ログ。
    if (strict) return false;
    console.log('  [img Sonnet予算切れ→Haiku単独で暫定採用]');
    await kvSet(cacheKey, true, 24 * 3600);
    return true;
  } catch { return true; }
}

// 既存商品(コスメ/フィギュア)を確信ゲートで再判定する。'same'(HIGH一致)/'different'(別物確定)/'unknown'(不通/予算切れ/取得不可)。
// 'different' の時だけ呼び出し側で除去する。'unknown' は落とさない＝確認できないものを誤って消さない(安全側)。
// existingIdsスキップで新規時しか効かないゲートを、保存済みの照合先画像で既存にも適用するために使う。
async function revalidateStrict(rakUrl, ebayUrl, rTitle, eTitle) {
  if (!rakUrl || !ebayUrl) return 'unknown';
  const cacheKey = `img_match5:${ebayQueryHash(rakUrl + ebayUrl)}`;
  const cached = await kvGet(cacheKey);
  if (cached !== null) return (cached === true || cached === 'true') ? 'same' : 'different';
  let img;
  try {
    const [r1, r2] = await Promise.all([
      fetch(upscaleRakuten(rakUrl), { signal: AbortSignal.timeout(6000) }),
      fetch(upscaleEbay(ebayUrl), { signal: AbortSignal.timeout(6000) }),
    ]);
    if (!r1.ok || !r2.ok) return 'unknown';
    const [a1, a2] = await Promise.all([r1.arrayBuffer(), r2.arrayBuffer()]);
    img = {
      b1: Buffer.from(a1).toString('base64'), mt1: r1.headers.get('content-type') ?? 'image/jpeg',
      b2: Buffer.from(a2).toString('base64'), mt2: r2.headers.get('content-type') ?? 'image/jpeg',
    };
  } catch { return 'unknown'; }
  const hai = await haikuStrict(img, rTitle, eTitle, null);
  if (hai === null) return 'unknown';                                    // Anthropic不通→落とさない
  if (hai === false) { await kvSet(cacheKey, false, 720 * 3600); return 'different'; }
  if (sonnetCallsToday >= MAX_SONNET_PER_RUN) return 'unknown';          // 予算切れ→落とさない(次回再判定)
  const son = await sonnetStrict(img, rTitle, eTitle, null, true);       // requireHigh
  if (son === null) return 'unknown';                                    // 不通→落とさない
  await kvSet(cacheKey, son, 720 * 3600);
  return son ? 'same' : 'different';
}

// ========== eBay OAuth トークン（Browse API用） ==========
let ebayTokenCache = null;
async function getEbayToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayTokenCache && Date.now() < ebayTokenCache.expiresAt) return ebayTokenCache.token;
  const encoded = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.error(`  [OAuth] HTTP ${res.status}`); return null; }
    const data = await res.json();
    ebayTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch (e) { console.error(`  [OAuth] ${e.message}`); return null; }
}

// ========== Phase 0: Pixel落札発掘(ebay_sold_seed)を読む ==========
// 旧: Browse APIで「現行出品」を取得 → 現在出品は売れる保証なし＝意味が薄い(ユーザー指摘2026-06-23)。
// 新: Pixel(住宅IP)が eBay 落札済み(Sold)をキーワード別にスクレイプ→KV ebay_sold_seed に格納。
//     refreshはそれを読み、楽天とマッチして「実際に売れた実績つき」候補だけを作る。
// EBAY_JP_QUERIES(124本) は ./ebayQueries.mjs に分離＝Pixel発掘workerと共有。

async function fetchEbayJapanSoldItems() {
  // Pixel(住宅IP)の落札発掘worker(ebaySoldWorker.mjs discover)が書いた種を読む。
  // 各 seed = {title, priceJpy(=eBay落札額), category, imageUrl, itemUrl(落札出品URL), rank, soldCount, soldWindowDays}。
  // priceJpy に「落札額」が入るので、以降のマッチ/利益計算はそのまま"実売値ベース"になる（現行出品の値では判定しない）。
  const seed = await kvGet('ebay_sold_seed');
  if (!seed || !Array.isArray(seed) || seed.length === 0) {
    console.error('  [Phase0] ebay_sold_seed が空。Pixel落札発掘worker未稼働の可能性→候補ゼロ。');
    return [];
  }
  const items = [];
  for (const s of seed) {
    const title = String(s?.title ?? '').trim();
    const priceJpy = Math.round(Number(s?.priceJpy) || 0);
    if (!title || priceJpy < 1000) continue;
    if (PROHIBITED_EXCLUDE.test(title)) continue; // 【厳命】香水/スプレー/電池等 国際発送不可・関税問題はseed段階で除外
    items.push({
      title,
      priceJpy,                            // = eBay落札額（マッチ後そのまま realAvgPrice へ）
      category: s?.category ?? '',
      imageUrl: s?.imageUrl ?? '',         // 落札出品のサムネ（楽天画像との同一判定に使う）
      itemUrl: s?.itemUrl ?? '',           // 落札済み出品URL（カードの「落札価格を見る」導線）
      rank: Number(s?.rank) || 0,
      soldSeed: true,                      // 落札由来マーク（最安再評価スキップ＋soldVerified付与に使う）
      soldCount: Number(s?.soldCount) || 0,
      soldWindowDays: Number(s?.soldWindowDays) || 0,
    });
  }
  // 順位インターリーブ：rank昇順＝各ジャンルの上位を横断で先頭へ→MAX_PROCESSの枠が"全ジャンルの美味しい順"に使われる。
  items.sort((a, b) => a.rank - b.rank);
  const seen = new Map();
  for (const it of items) if (!seen.has(it.title)) seen.set(it.title, it); // 重複は上位(rank小)を残す
  const unique = [...seen.values()];
  console.log(`  [Phase0] ebay_sold_seed ${seed.length}件 → 有効${unique.length}件（落札ベース）`);
  return unique;
}

// eBayタイトル → 楽天日本語キーワード変換（Haiku、KVキャッシュ168h）
async function ebayTitleToRakutenKeyword(ebayTitle) {
  if (!ANTHROPIC_API_KEY) return null;
  const cacheKey = `rakuten_kw2:${ebayQueryHash(ebayTitle)}`; // 翻訳プロンプト強化に伴い旧キャッシュを無効化
  const cached = await kvGet(cacheKey);
  if (cached) return cached;

  try {
    await haikuGate(); // レート制限内に収める（キャッシュミス時のみ到達）
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 60,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Convert this eBay listing title into a Japanese Rakuten search keyword that finds the SAME product.
Rules:
- Keep the specific product/character name, series, model number, card number, set name and size. These decide whether the same item is found.
- Use the Japanese name for well-known brands/series (Nendoroid→ねんどろいど, Demon Slayer→鬼滅の刃, Dragon Ball→ドラゴンボール). amiibo/figma/LEGO/SK-II stay as-is. Model numbers and proper nouns may stay in latin letters.
- Drop generic filler (japan, new, sealed, lot, authentic, US seller).
- Max 6 words.
eBay title: "${ebayTitle}"
Output only the keyword.`
        }]
      }),
      signal: AbortSignal.timeout(10000),
    });
    haikuCallsToday++;
    if (!res.ok) return null;
    const data = await res.json();
    const kw = data?.content?.[0]?.text?.trim() ?? '';
    if (!kw || kw.length < 2) return null;
    await kvSet(cacheKey, kw, 720 * 3600);
    return kw;
  } catch { return null; }
}

// 楽天の日本語タイトル → eBay検索用の英語キーワード（汎用的すぎるeBayタイトルの置換用）。
// 型番・キット名・キャラ名・容量を残し、状態/発送語は省く。Haiku・168hキャッシュ。
async function rakutenTitleToEnglishKeyword(jpTitle) {
  if (!ANTHROPIC_API_KEY) return null;
  const cacheKey = `en_kw:${ebayQueryHash(jpTitle)}`;
  const cached = await kvGet(cacheKey);
  if (cached) return cached;
  try {
    await haikuGate();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 40,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Convert this Japanese product title into a short English eBay search query (max 6 words) that uniquely identifies the product. Keep model numbers, kit names, character names and sizes; drop condition/shipping/seller words.
Japanese: "${jpTitle}"
Output only the English query, nothing else.`,
        }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    haikuCallsToday++;
    if (!res.ok) return null;
    const data = await res.json();
    const kw = data?.content?.[0]?.text?.trim() ?? '';
    if (!kw || kw.length < 3) return null;
    await kvSet(cacheKey, kw, 720 * 3600);
    return kw;
  } catch { return null; }
}

// ========== 相場(単品中央値)の取得 ==========
// coreKeyword から識別子(型番/カード番号)を残した検索語を作る（toEbayMarketUrl と同方針）。
const PRICE_NOISE = /\b(new|sealed|unopened|opened|mint|nib|misb|bnib|preowned|pre-owned|used|official|authentic|genuine|japan|japanese|jp|import|imported|version|ver|limited|edition|exclusive|free|shipping|fast|tracking|rare|htf|lot|with|for|from|the|and|of|in|brand|preorder|pre-order)\b/gi;
function searchQueryFor(coreKeyword) {
  const ts = (coreKeyword || '')
    .replace(/【[^】]*】/g, ' ').replace(/[^\x00-\x7F]/g, ' ').replace(/[^A-Za-z0-9#.\/\s-]/g, ' ')
    .replace(PRICE_NOISE, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const isId = t => /\d/.test(t) || /[A-Za-z].*-.*[A-Za-z0-9]/.test(t);
  const ids = ts.filter(isId).slice(0, 2);
  const names = ts.filter(t => !isId(t)).slice(0, 4);
  const picked = [...names, ...ids];
  return (picked.length ? picked : ts.slice(0, 6)).join(' ');
}

// セット/まとめ売り(複数個)の除外。中央値を「単品」に寄せる。
const PRICE_SET_RE = /\b(lot of \d|set of \d|\d+\s*pcs|\d+\s*pieces|bundle|\d+\s*x\b|x\s*\d+|\d+\s*-?\s*pack|joblot|job lot|wholesale|\d+\s*set\b)\b/i;
// 別売りアクセサリ/部品（本体でない安い同キーワード品）を相場計算から除外。本体をLEDユニット等の安値と比較して
// 価格が狂う/別物判定になる事故を防ぐ（監査でPG Unleashedの最安がアクセサリだった）。本体名に出にくい語に限定。
const PRICE_ACCESSORY_RE = /\b(led unit|led set|action base|display base|stand only|expansion set|option parts|parts only|water[\s-]?decal|decal set|sticker sheet|photo[\s-]?etch|metal parts|conversion kit|garage kit|empty box|box only|outer box|manual only|instruction manual)\b/i;
// 片方だけが「別売アクセサリ/部品」なら別物。本体↔LEDユニット等の誤マッチを弾く（両方アクセサリ/両方本体は通す）。
function accessoryMismatch(a, b) {
  return PRICE_ACCESSORY_RE.test(a || '') !== PRICE_ACCESSORY_RE.test(b || '');
}
// 複数機種を1ページに混載した曖昧リスト(例: 腕時計でSBTR005〜SBTR029を列挙)。買い手が変種を選ぶ必要があり単品特定不可なので除外。
function isMultiModelListing(title) {
  return extractCodes(title || '').length >= 4;
}
function trimmedMedianJpy(pricesJpy) {
  const xs = pricesJpy.filter(p => p > 0).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const m0 = xs[Math.floor(xs.length / 2)];
  const kept = xs.filter(p => p >= m0 * 0.4 && p <= m0 * 2.5); // 外れ値(付属品/極端値)をトリム
  const use = kept.length >= 3 ? kept : xs;
  // low = 外れ値除去後の最安（ロバストな最安）。median は併記用。
  return { median: use[Math.floor(use.length / 2)], low: use[0], count: use.length };
}

// 比較品のタイトル/画像/価格を1件に整形。通貨はJPY換算。
function compFromSummary(it) {
  const v = parseFloat(it?.price?.value); const c = it?.price?.currency;
  const price = !v || v <= 0 ? 0
    : c === 'USD' ? Math.round(v * USD_TO_JPY)
    : c === 'GBP' ? Math.round(v * GBP_TO_JPY)
    : c === 'AUD' ? Math.round(v * AUD_TO_JPY)
    : c === 'JPY' ? Math.round(v) : 0;
  return { title: it?.title ?? '', img: it?.image?.imageUrl ?? it?.thumbnailImages?.[0]?.imageUrl ?? '', price };
}

// 比較品を「アンカー(画像照合済み)と同一商品」に絞る。型番が明確に違う/容量orスケール違い/本体↔付属品/
// 多機種混載 を落とす。型番が無い側は保留(残す)＝型番を省いた安い同一品を消さない。
function sameProductComps(comps, anchorTitle) {
  return comps.filter(c =>
    priceCodeCompat(anchorTitle, c.title) !== false &&
    !sizeMismatch(anchorTitle, c.title) &&
    !accessoryMismatch(anchorTitle, c.title) &&
    !isMultiModelListing(c.title)
  );
}

// 価格を決める「最安」をアンカー画像で確定する。最安がアンカー価格よりかなり安い(=別の安い商品の疑い)時だけ、
// 安い順に画像照合し、別物(false)を落としてやり直す。予算/件数上限つき。同一or判定不能(fail-open)で確定。
async function verifyCheapestComps(kept, anchor) {
  if (!anchor?.rakutenImg || !anchor?.anchorPriceJpy || !kept.length) return kept;
  const sorted = kept.slice().sort((a, b) => a.price - b.price);
  let n = 0;
  while (sorted.length && n < PRICE_VERIFY_PER_ITEM && priceVerifyToday < PRICE_VERIFY_BUDGET) {
    const cheapest = sorted[0];
    if (cheapest.price >= anchor.anchorPriceJpy * 0.7) break; // 安すぎない＝妥当→確定
    if (!cheapest.img) break;
    priceVerifyToday++; n++;
    const same = await isImageMatch(anchor.rakutenImg, cheapest.img, {
      rakutenTitle: anchor.rakutenTitle || '', ebayTitle: cheapest.title, rakutenQuantity: anchor.rakutenQuantity ?? null,
    });
    if (same) break;       // 最安が同一品(or判定不能)→採用
    sorted.shift();        // 別物→落として次の最安へ
  }
  return sorted;
}

// eBay現在出品の「単品中央値(JPY)」。アンカーと同一商品に絞り、最安は画像で確定。外れ値トリム。
// キャッシュはアンカーの型番/容量も鍵に含める（別商品の汚染相場を配らないため）。24hキャッシュ。少数/失敗時null。
async function ebayMedianSinglePriceJpy(query, anchor = {}) {
  if (!query) return null;
  const anchorTitle = anchor.title || '';
  const idKey = extractCodes(anchorTitle)[0] || extractSize(anchorTitle).vol[0] || extractSize(anchorTitle).scale[0] || 'noid';
  const cacheKey = `median_jpy3:${ebayQueryHash(query)}:${idKey}`; // v3: 同一商品絞り込み＋アンカー鍵
  const cached = await kvGet(cacheKey);
  if (cached && typeof cached === 'object' && cached.median > 0) return cached;
  const token = await getEbayToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({ q: query, limit: '24', fieldgroups: 'COMPACT' });
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const comps = (data?.itemSummaries ?? [])
      .map(compFromSummary)
      .filter(c => c.price > 0 && c.title && !PRICE_SET_RE.test(c.title) && !PRICE_ACCESSORY_RE.test(c.title));
    const kept = await verifyCheapestComps(sameProductComps(comps, anchorTitle), anchor);
    const result = trimmedMedianJpy(kept.map(c => c.price));
    if (result) await kvSet(cacheKey, result, 24 * 3600);
    return result;
  } catch { return null; }
}

// ========== 落札価格(Marketplace Insights API) — 承認後に有効化 ==========
//
// 【現状】eBay の Marketplace Insights API (item_sales/search = 実際の落札/売却データ) は
//   申請承認制。未承認のうちは下の機能は EBAY_INSIGHTS_ENABLED で OFF にしてあり、相場は
//   従来どおり「現在出品の単品中央値(ebayMedianSinglePriceJpy)」を使う＝挙動は一切変わらない。
//
// 【承認されたら有効化する手順（これだけ）】
//   1. Vercel と GitHub Actions(refresh) の env に  EBAY_INSIGHTS_ENABLED=1  を足す。
//      ※ EBAY_APP_ID / EBAY_CLIENT_SECRET はそのまま。insights スコープは
//        getEbayInsightsToken() が「本フラグ ON のときだけ」要求するので、承認前に
//        スコープを足して本体トークン取得を壊す事故は起きない設計。
//   2. 次の refresh(CI) から、相場が「実売(落札)中央値」優先に切り替わる。
//      取れない/サンプル僅少なら自動で現在出品中央値へフォールバック。
//   3. ログ「💱 実売中央値を採用」で実際に効いているか確認する。
//   （任意）将来 UI で「相場」→「実売◯件」と出し分けるなら、marketMedianPriceJpy が返す
//     soldBased を product に通して ProductCard の表記を分岐させる。
const INSIGHTS_ENABLED = process.env.EBAY_INSIGHTS_ENABLED === '1';
const INSIGHTS_SCOPE = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

// insights スコープ専用トークン（本体の api_scope トークンとは別キャッシュ。
// 承認前にこのスコープを要求すると失敗するため、INSIGHTS_ENABLED のときだけ呼ぶ）。
let ebayInsightsTokenCache = null;
async function getEbayInsightsToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null;
  if (ebayInsightsTokenCache && Date.now() < ebayInsightsTokenCache.expiresAt) return ebayInsightsTokenCache.token;
  const encoded = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(INSIGHTS_SCOPE)}`,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.error(`  [Insights OAuth] HTTP ${res.status}（未承認の可能性）`); return null; }
    const data = await res.json();
    ebayInsightsTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch (e) { console.error(`  [Insights OAuth] ${e.message}`); return null; }
}

// eBay「落札(実売)中央値(JPY)」。Marketplace Insights の item_sales/search を叩く。
// セット除外＋外れ値トリムは現在出品版と同じ。24hキャッシュ。失敗/少数時は null。
async function ebaySoldMedianPriceJpy(query, anchor = {}) {
  if (!query || !INSIGHTS_ENABLED) return null;
  const anchorTitle = anchor.title || '';
  const idKey = extractCodes(anchorTitle)[0] || extractSize(anchorTitle).vol[0] || 'noid';
  const cacheKey = `sold_jpy2:${ebayQueryHash(query)}:${idKey}`; // 同一商品絞り込み＋アンカー鍵
  const cached = await kvGet(cacheKey);
  if (cached && typeof cached === 'object' && cached.median > 0) return { ...cached, soldBased: true };
  const token = await getEbayInsightsToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({ q: query, limit: '24' });
    const res = await fetch(`https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const comps = (data?.itemSales ?? []).map(it => {
      const p = it?.lastSoldPrice ?? it?.price; // Insights は lastSoldPrice（実売価格）
      const v = parseFloat(p?.value); const c = p?.currency;
      const price = !v || v <= 0 ? 0
        : c === 'USD' ? Math.round(v * USD_TO_JPY)
        : c === 'GBP' ? Math.round(v * GBP_TO_JPY)
        : c === 'AUD' ? Math.round(v * AUD_TO_JPY)
        : c === 'JPY' ? Math.round(v) : 0;
      return { title: it?.title ?? '', img: it?.image?.imageUrl ?? '', price };
    }).filter(c => c.price > 0 && c.title && !PRICE_SET_RE.test(c.title) && !PRICE_ACCESSORY_RE.test(c.title));
    // 実売も同一商品に絞る（型番/容量/付属品/多機種）。画像検証は現在出品側で実施済みのためここでは行わない。
    const result = trimmedMedianJpy(sameProductComps(comps, anchorTitle).map(c => c.price));
    if (result) await kvSet(cacheKey, result, 24 * 3600);
    return result ? { ...result, soldBased: true } : null;
  } catch { return null; }
}

// 相場の中央値(JPY)。承認後(INSIGHTS_ENABLED=1)は「実売中央値」を優先し、取れない/サンプル
// 僅少なら「現在出品の単品中央値」にフォールバック。フラグOFF時は完全に従来挙動。
async function marketMedianPriceJpy(query, anchor = {}) {
  if (INSIGHTS_ENABLED) {
    const sold = await ebaySoldMedianPriceJpy(query, anchor);
    if (sold && sold.count >= 3) { console.log('  💱 実売中央値を採用'); return sold; }
  }
  return ebayMedianSinglePriceJpy(query, anchor);
}

// ========== ③ 楽天-first 発掘（フラグ制・eBay先が取りこぼす商品を楽天人気起点で拾う） ==========
// 既定OFF。RAKUTEN_FIRST=1 で有効化。実験(A/B/C)でB(楽天先)がeBay先の取りこぼし(amiibo/トレカ等)を拾うと実証済み。
// 照合ゲート(数量/番号/画像合議/利益率/禁制/中古/価格比)は eBay-first と完全共通＝品質は同水準。コストはRF_MAX_MATCHで上限固定。
const RAKUTEN_FIRST_ENABLED = process.env.RAKUTEN_FIRST === '1';
const RAKUTEN_SEED_QUERIES = [
  { kw: 'ポケモンカード 未開封 BOX', name: 'ポケモンカード' },
  { kw: 'ねんどろいど 新品 未開封', name: 'ねんどろいど' },
  { kw: 'figma 新品', name: 'figma' },
  { kw: 'S.H.Figuarts 新品', name: 'SHF' },
  { kw: 'POP UP PARADE 新品', name: 'POP UP PARADE' },
  { kw: 'ガンプラ RG 新品', name: 'ガンプラRG' },
  { kw: 'G-SHOCK 新品', name: 'Gショック' },
  { kw: 'セイコー 腕時計 新品', name: 'セイコー' },
  { kw: '資生堂 スキンケア 新品', name: '資生堂' },
  { kw: 'amiibo 新品 未開封', name: 'アミーボ' },
  { kw: 'ベイブレードX 新品', name: 'ベイブレードX' },
  { kw: 'ポケモンセンター ぬいぐるみ 新品', name: 'ポケセンぬいぐるみ' },
];
const RF_PER_GENRE = 4, RF_EBAY_CAND = 2, RF_MAX_MATCH = 80;

// 汎用 eBay Browse 検索（NEW・Best Match）。{title, priceJpy, img, url}。禁制/セットは除外。
async function ebayItemsByQuery(query, limit = 8) {
  if (!query) return [];
  const token = await getEbayToken();
  if (!token) return [];
  try {
    const params = new URLSearchParams({ q: query.slice(0, 120), filter: 'conditions:{NEW|LIKE_NEW}', limit: String(limit), fieldgroups: 'COMPACT' });
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d?.itemSummaries ?? []).map(it => {
      const v = parseFloat(it?.price?.value), c = it?.price?.currency;
      let priceJpy = 0;
      if (c === 'USD') priceJpy = Math.round(v * USD_TO_JPY);
      else if (c === 'GBP') priceJpy = Math.round(v * GBP_TO_JPY);
      else if (c === 'AUD') priceJpy = Math.round(v * AUD_TO_JPY);
      else if (c === 'JPY') priceJpy = Math.round(v);
      return { title: it?.title ?? '', priceJpy, img: it?.image?.imageUrl ?? it?.thumbnailImages?.[0]?.imageUrl ?? '', url: it?.itemWebUrl ?? '' };
    }).filter(x => x.title && x.priceJpy > 0 && x.img && !PRICE_SET_RE.test(x.title) && !PRICE_ACCESSORY_RE.test(x.title) && !PROHIBITED_EXCLUDE.test(x.title));
  } catch { return []; }
}

// 楽天人気品を起点に eBay相場を確認して利益商品を作る。haveIds(楽天itemCode集合)で重複排除。
async function processRakutenFirst(haveIds) {
  const out = [];
  let matchBudget = RF_MAX_MATCH;
  for (const { kw, name } of RAKUTEN_SEED_QUERIES) {
    if (matchBudget <= 0) break;
    let rItems = [];
    try { rItems = (await fetchRakutenPage(kw, 1)).map(x => x.Item).filter(Boolean); } catch { continue; }
    rItems = rItems.filter(it => it.itemPrice >= 1000
      && Number(it.availability) !== 0            // 在庫切れ(売り切れ)は対象外
      && !EXCLUDE_PATTERN.test(it.itemName) && !ACCESSORY_EXCLUDE_PATTERN.test(it.itemName)
      && !PART_EXCLUDE.test(it.itemName) && !SET_EXCLUDE.test(it.itemName)
      && !USED_EXCLUDE.test(it.itemName) && !PREORDER_EXCLUDE.test(it.itemName) && !PROHIBITED_EXCLUDE.test(it.itemName)
      && quantityOf(it.itemName) === 1 && !isMultiModelListing(it.itemName) && !haveIds.has(it.itemCode));
    for (const r of rItems.slice(0, RF_PER_GENRE)) {
      if (matchBudget <= 0) break;
      if (haveIds.has(r.itemCode)) continue;
      const rakutenImg = r.mediumImageUrls?.[0]?.imageUrl || r.smallImageUrls?.[0]?.imageUrl || '';
      if (!rakutenImg) continue;
      const enKw = await rakutenTitleToEnglishKeyword(r.itemName);
      if (!enKw) continue;
      const eItems = await ebayItemsByQuery(enKw, RF_EBAY_CAND + 4);
      for (const e of eItems.slice(0, RF_EBAY_CAND)) {
        if (quantityOf(e.title) !== 1) continue;
        if (codesConflict(r.itemName, e.title)) continue;
        if (accessoryMismatch(r.itemName, e.title)) continue; // 本体↔別売アクセサリ(LEDユニット等)の誤マッチ防止
        const pointRate = r.pointRate ?? 1;
        const pointAmount = Math.floor(r.itemPrice * pointRate / 100);
        const cat = guessCategory(r.itemName);
        const shipJpy = domesticShipping(cat, r.postageFlag, r.itemName);
        const { profit, profitRate } = calcProfit(r.itemPrice, e.priceJpy, pointAmount, shipJpy);
        if (profitRate <= PROFIT_RATE_FLOOR || profitRate > 300) continue;
        if (e.priceJpy > r.itemPrice * PRICE_RATIO_MAX) continue;
        if (matchBudget <= 0) break;
        matchBudget--;
        if (!(await isImageMatch(rakutenImg, e.img, { rakutenTitle: r.itemName, ebayTitle: e.title, rakutenQuantity: 1 }))) continue;
        const coreKeyword = isWeakKeyword(e.title) ? (enKw || e.title) : e.title;
        let realAvgPrice = e.priceJpy, realMedianPrice = e.priceJpy, realCount = 1, finalProfit = profit, finalRate = profitRate;
        const med = await marketMedianPriceJpy(searchQueryFor(coreKeyword), { title: e.title, rakutenImg, rakutenTitle: r.itemName, anchorPriceJpy: e.priceJpy });
        if (med && med.count >= 5) {
          const low = med.low ?? med.median;
          realAvgPrice = Math.min(e.priceJpy, low); realMedianPrice = med.median; realCount = med.count;
          const rr = calcProfit(r.itemPrice, realAvgPrice, pointAmount, shipJpy);
          finalProfit = rr.profit; finalRate = rr.profitRate;
          if (finalRate <= PROFIT_RATE_FLOOR || finalRate > 300) continue;
        }
        haveIds.add(r.itemCode);
        out.push({
          id: r.itemCode, title: r.itemName, imageUrl: rakutenImg, images: (r.mediumImageUrls ?? []).map(x => x?.imageUrl).filter(Boolean), category: cat,
          source: { site: 'rakuten', siteName: '楽天', price: r.itemPrice, url: r.itemUrl || r.affiliateUrl, pointRate, pointAmount, shippingJpy: shipJpy, postageIncluded: Number(r.postageFlag) === 0 }, // 楽天アフィリ廃止：直リンク(itemUrl)を優先保存
          isNew: r.itemName.includes('新品') || r.itemName.includes('未開封'),
          market: 'EBAY_US', coreKeyword,
          ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(coreKeyword)}&LH_Complete=1&LH_Sold=1`,
          realAvgPrice, realMedianPrice, realProfit: finalProfit, realProfitRate: finalRate, realCount,
          avgDaysToSell: null, addedAt: new Date().toISOString(),
          // 監査が本番でマッチさせたeBay商品を採点できるよう保存。
          matchedEbayImageUrl: e.img || '', matchedEbayUrl: e.url || '', matchedEbayTitle: e.title || '',
        });
        console.log(`  🔁 [楽天先/${name}] ${finalRate}% | 楽天¥${r.itemPrice.toLocaleString()} → eBay¥${realAvgPrice.toLocaleString()} | ${r.itemName.slice(0, 30)}`);
        break; // この楽天品は1件成立で次へ
      }
      await sleep(150);
    }
  }
  return out;
}

// ========== メイン処理 ==========
async function main() {
  console.log(`\n🚀 refresh.mjs 開始 ${new Date().toISOString()}`);
  const startedAt = Date.now();

  // Phase 0: eBay日本発送売れ済み商品を取得（6時間キャッシュ）
  console.log('\n🌐 Phase 0: eBay日本発送売れ済み商品を取得...');
  const ebayJpItems = await fetchEbayJapanSoldItems();
  console.log(`  取得: ${ebayJpItems.length}件`);

  if (ebayJpItems.length === 0) {
    console.log('  ⚠️ eBay売れ筋商品が取得できませんでした。終了します。');
    return;
  }

  // 既存DB・チェック済みIDをロード
  const CHECKED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90日
  const now = Date.now();
  // KVが想定外の非配列値（破損・切り詰めJSON等）を返しても run 全体が落ちないようガード
  const rawChecked = await kvGet('checked_ids');
  const validChecked = (Array.isArray(rawChecked) ? rawChecked : [])
    .map(e => typeof e === 'string' ? { id: e, checkedAt: 0 } : e)
    .filter(e => now - e.checkedAt < CHECKED_TTL_MS);
  const checkedIds = new Set(validChecked.map(e => e.id));
  const allCheckedMap = new Map(validChecked.map(e => [e.id, e]));

  const rawProducts = await kvGet('profitable_products');
  const loadedProducts = (Array.isArray(rawProducts) ? rawProducts : []).map(p => {
    // 旧データの ebaySoldUrl が現行出品URLになっている場合は売れ済み検索URLに修正
    if (p.ebaySoldUrl && !p.ebaySoldUrl.includes('LH_Sold=1') && p.coreKeyword) {
      p.ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(p.coreKeyword)}&LH_Complete=1&LH_Sold=1`;
    }
    // addedAt 未設定の旧データは固定の過去時刻で補完（既存の並び順を保ったまま新着の下に来る）
    if (!p.addedAt) p.addedAt = '2020-01-01T00:00:00.000Z';
    return p;
  });
  // 現行カタログを先に出品アーカイブへ退避。このrunの維持処理で入れ替わって落ちる商品も、
  // 仕入れた人が出品し続けられるようにする（最後に保存後、末尾でも更新してTTLを延ばす）。
  await kvArchiveProducts(loadedProducts);
  // id重複を毎回自動で排除（過去のバグ由来の残存重複を定期クリーンアップ）。最初の出現を優先。
  const seenIds = new Set(); // 楽天itemCode
  let dedupedProducts = loadedProducts.filter(p => {
    if (!p.id || seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });
  const dupRemoved = loadedProducts.length - dedupedProducts.length;
  if (dupRemoved > 0) console.log(`  🧹 重複DB自動クリーンアップ: ${dupRemoved}件除去`);

  // 既存商品にも最新ロジックを遡及適用：カテゴリを再判定（誤分類の修正）し、
  // coreKeyword が汎用的すぎる場合は楽天タイトルの英訳に差し替える（相場検索の精度向上）。
  // guessCategory は純関数で安全、英訳は en_kw キャッシュ済みのため負荷は小さい。
  let recat = 0, rekw = 0;
  for (const p of dedupedProducts) {
    if (p.title) {
      const c = guessCategory(p.title);
      if (c !== p.category) { p.category = c; recat++; }
    }
    if (p.coreKeyword && p.title && isWeakKeyword(p.coreKeyword)) {
      const en = await rakutenTitleToEnglishKeyword(p.title);
      if (en && en !== p.coreKeyword) {
        p.coreKeyword = en;
        p.ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(en)}&LH_Complete=1&LH_Sold=1`;
        rekw++;
      }
    }
  }
  if (recat || rekw) console.log(`  🔧 既存データ補正: カテゴリ再判定 ${recat}件 / coreKeyword英訳 ${rekw}件`);

  // 既存の誤マッチ（カード番号/型番が楽天タイトルと食い違う＝別商品）を除外。
  {
    const before = dedupedProducts.length;
    dedupedProducts = dedupedProducts.filter(p => !(p.title && p.coreKeyword && codesConflict(p.title, p.coreKeyword)));
    const dropped = before - dedupedProducts.length;
    if (dropped) console.log(`  🧹 番号不一致の誤マッチを除外: ${dropped}件`);
  }

  // 既存カタログの国内送料を「正確な信号」で再計算（送料無料/込み=¥0・送料別=概算）し、利益を更新。
  // postageIncluded(=postageFlag0) と タイトルの送料無料/込み表記から判定。後段の利益率フィルタに反映される。
  {
    let fixed = 0;
    for (const p of dedupedProducts) {
      if (!p.source || !(p.realAvgPrice > 0) || !(p.source.price > 0)) continue;
      const ship = domesticShipping(p.category, p.source.postageIncluded ? 0 : 1, p.title);
      if (p.source.shippingJpy === ship) continue;
      p.source.shippingJpy = ship;
      const r = calcProfit(p.source.price, p.realAvgPrice, p.source.pointAmount ?? 0, ship);
      p.realProfit = r.profit; p.realProfitRate = r.profitRate;
      fixed++;
    }
    if (fixed) console.log(`  📦 国内送料を正確な信号で再計算(無料/込み=0・送料別=概算): ${fixed}件`);
  }

  // 既存の別物アクセサリ(互換バンド/社外部品)・複数個セット・価格比異常 を除外（監査で腕時計の誤マッチ多数判明）。
  {
    const before = dedupedProducts.length;
    dedupedProducts = dedupedProducts.filter(p => {
      if (p.title && (PART_EXCLUDE.test(p.title) || SET_EXCLUDE.test(p.title))) return false;
      if (p.title && USED_EXCLUDE.test(p.title)) return false; // 中古品（新品相場と比較され利益過大の誤検知）
      if (p.title && PREORDER_EXCLUDE.test(p.title)) return false; // 予約/発売前/受注/取り寄せ＝即発送できないので既存からも除去
      if (p.title && isMultiModelListing(p.title)) return false; // 複数機種混載リスト=単品特定不可（誤マッチ源）既存からも除去
      if (p.title && PROHIBITED_EXCLUDE.test(p.title)) return false; // 【厳命】国際発送不可・関税問題ジャンルは既存からも除去
      if (p.title && quantityOf(p.title) > 1) return false;    // 複数パック(数量>1)＝単品相場と比較され価格が狂う
      if (typeof p.realProfitRate === "number" && p.realProfitRate <= PROFIT_RATE_FLOOR) return false; // 利益率10%以下は出さない
      // ⑤ 価格比サニティ（既存にも適用）
      if (p.realAvgPrice > 0 && p.source?.price > 0 && p.realAvgPrice > p.source.price * PRICE_RATIO_MAX) return false;
      return true;
    });
    const dropped = before - dedupedProducts.length;
    if (dropped) console.log(`  🧹 互換部品/セット/中古/数量違い/価格比異常の誤マッチを除外: ${dropped}件`);
  }

  // 既存商品のジャンルを最新の guessCategory で再分類する（ブランド/シリーズ語の追加を反映）。
  // 「その他」に取りこぼしていたコスメ/フィギュア/模型を正しいジャンルへ直し、下の確信ゲート再判定の
  // 対象に乗せる（誤分類で確信ゲートをすり抜けていた誤マッチを拾うため。ジャンル別精度も正確になる）。
  {
    let recat = 0;
    for (const p of dedupedProducts) {
      if (!p.title) continue;
      const c = guessCategory(p.title);
      if (c !== p.category) { p.category = c; recat++; }
    }
    if (recat) console.log(`  🏷️ 既存ジャンルを最新の分類で再判定: ${recat}件`);
  }

  // 既存のコスメ/フィギュアを確信ゲートで再判定し、別物と確定したものだけ除去する。
  // (existingIdsスキップで新規時しか効かないゲートを、保存済み照合先画像で既存にも適用。リセット不要)
  // 'unknown'(確認不能)は落とさない＝安全側。判定はv5キャッシュに残るので次回以降は無料。
  {
    const before = dedupedProducts.length;
    const kept = [];
    for (const p of dedupedProducts) {
      if ((p.category === 'コスメ' || p.category === 'フィギュア' || p.category === 'ガンプラ') && p.imageUrl && p.matchedEbayImageUrl) {
        const v = await revalidateStrict(p.imageUrl, p.matchedEbayImageUrl, p.title || '', p.matchedEbayTitle || '');
        if (v === 'different') continue; // 別物確定→除去（確信HIGHで同一と取れなかったコスメ/フィギュア）
      }
      kept.push(p);
    }
    dedupedProducts = kept;
    const dropped = before - dedupedProducts.length;
    if (dropped) console.log(`  🧹 コスメ/フィギュア/ガンプラを確信ゲートで再判定し別物を除去: ${dropped}件`);
  }

  // 既存商品の相場を「eBay最安値ベース」に再評価（早く売る前提の正直な利益表示）。中央値は併記用に保持。
  // 安全装置：万一ほぼ全件(>85%)が利益消失するなら取得異常を疑い適用を見送る（最安化で件数が減るのは想定内なので閾値は高め）。
  const repriced = [];
  for (const p of dedupedProducts) {
    if (p.soldVerified) continue; // 落札確定品は実売値を維持（現行出品の中央値で上書きしない）
    if (!p.coreKeyword || !p.source || !(p.realAvgPrice > 0)) continue;
    const med = await marketMedianPriceJpy(searchQueryFor(p.coreKeyword), { title: p.matchedEbayTitle || p.coreKeyword, rakutenImg: p.imageUrl, rakutenTitle: p.title, anchorPriceJpy: p.realAvgPrice });
    if (!med || med.count < 5) continue;
    const low = med.low ?? med.median;                 // ★eBay最安ベース（旧キャッシュ対策で中央値フォールバック）
    if (low >= p.realAvgPrice) { p.realCount = med.count; p.realMedianPrice = med.median; continue; } // 下がらないなら件数/中央値だけ反映
    const r = calcProfit(p.source.price, low, p.source.pointAmount ?? 0, p.source.shippingJpy ?? 0);
    repriced.push({ p, newAvg: low, median: med.median, count: med.count, profit: r.profit, rate: r.profitRate });
  }
  const wouldDrop = repriced.filter(x => x.rate <= PROFIT_RATE_FLOOR).length;
  if (repriced.length && wouldDrop / dedupedProducts.length > 0.85) {
    console.log(`  ⚠️ 最安再評価で${wouldDrop}/${dedupedProducts.length}件が利益率${PROFIT_RATE_FLOOR}%以下(>85%)。取得異常の可能性があるため再評価を見送り。`);
  } else if (repriced.length) {
    const drop = new Set();
    let updated = 0;
    for (const x of repriced) {
      x.p.realAvgPrice = x.newAvg; x.p.realMedianPrice = x.median; x.p.realCount = x.count; x.p.realProfit = x.profit; x.p.realProfitRate = x.rate;
      if (x.rate <= PROFIT_RATE_FLOOR) drop.add(x.p.id); else updated++; // 利益率10%以下は一覧から除外
    }
    dedupedProducts = dedupedProducts.filter(p => !drop.has(p.id));
    console.log(`  💹 相場をeBay最安値で是正: ${updated}件更新 / ${drop.size}件は利益率${PROFIT_RATE_FLOOR}%以下で除外`);
  }

  const existingIds = new Set(dedupedProducts.map(p => p.id)); // 楽天itemCode
  const existingProducts = dedupedProducts;
  const profitableProducts = [...existingProducts];

  console.log(`  既存DB: ${existingProducts.length}件 / チェック済み: ${checkedIds.size}件`);

  // 未処理のeBayアイテムに絞り込み（eBayタイトルハッシュをIDとして管理）
  const MAX_PROCESS = Number(process.env.MAX_PROCESS) || 400; // 1実行あたり処理するeBay新規件数。poolの埋め戻し時はenvで一時的に上げる。
  const CONCURRENCY = 5;

  const toProcess = ebayJpItems.filter(item => {
    const id = String(ebayQueryHash(item.title));
    return !checkedIds.has(id);
  }).slice(0, MAX_PROCESS);

  console.log(`\n🔍 Phase 1→2: ${toProcess.length}件を処理 (並列${CONCURRENCY}件)...`);

  // 1件のeBay商品を処理: キーワード変換 → 楽天検索 → 画像マッチ → 利益計算
  async function processEbayItem(ebayItem) {
    const itemId = String(ebayQueryHash(ebayItem.title));

    // Haiku: eBayタイトル → 日本語楽天キーワード
    const jpKeyword = await ebayTitleToRakutenKeyword(ebayItem.title);
    if (!jpKeyword) return { type: 'skip', id: itemId };

    // 楽天で検索（2ページ）
    const rakutenItems = [];
    for (const page of [1, 2]) {
      const items = await fetchRakutenPage(jpKeyword, page);
      for (const raw of items) {
        const it = raw.Item;
        if (!it || it.itemPrice < 1000) continue;
        if (Number(it.availability) === 0) continue;       // 在庫切れ(売り切れ)＝今は仕入れられないので対象外
        if (isMultiModelListing(it.itemName)) continue;    // 複数機種混載リスト＝単品特定不可で誤マッチ源
        if (EXCLUDE_PATTERN.test(it.itemName)) continue;
        if (ACCESSORY_EXCLUDE_PATTERN.test(it.itemName)) continue;
        if (PART_EXCLUDE.test(it.itemName)) continue;     // 互換バンド/社外部品 等の別物アクセサリ
        if (SET_EXCLUDE.test(it.itemName)) continue;       // 複数個セット/まとめ売り
        if (USED_EXCLUDE.test(it.itemName)) continue;      // 中古/ユーズド/ジャンク（新品相場比較で利益過大）
        if (PREORDER_EXCLUDE.test(it.itemName)) continue;  // 予約/発売前/受注/取り寄せ＝即発送できないので対象外
        if (PROHIBITED_EXCLUDE.test(it.itemName)) continue; // 【厳命】香水/スプレー/電池/ライター等 国際発送不可・関税問題ジャンルは絶対対象外
        if (existingIds.has(it.itemCode)) continue;
        rakutenItems.push(it);
      }
      await sleep(1100);
    }

    if (rakutenItems.length === 0) return { type: 'skip', id: itemId };

    const ebayImg = ebayItem.imageUrl ?? '';

    // 楽天上位5件: 先に利益計算（算術のみ・Haiku不要）→ 利益が出る候補だけ画像マッチ（Haiku）。
    // eBay価格は確定済みなので利益判定にHaikuは不要。これで無駄な画像マッチ呼び出しを大幅削減。
    for (const rakutenItem of rakutenItems.slice(0, 10)) { // 候補を5→10に拡大（同一品の成立率=歩留まり向上）
      const rakutenImg = rakutenItem.mediumImageUrls?.[0]?.imageUrl
        || rakutenItem.smallImageUrls?.[0]?.imageUrl || '';
      if (!rakutenImg) continue; // 画像なしは商品表示にも使えないのでスキップ

      // ① 利益計算（Haiku不要）。利益が出ないものはここでスキップ＝Haiku節約
      // ポイントは楽天APIの実際の倍率を使う（base 1倍=1%）。1箇所で算出し表示・利益計算で共有。
      const pointRate = rakutenItem.pointRate ?? 1;
      const pointAmount = Math.floor(rakutenItem.itemPrice * pointRate / 100);
      const cat = guessCategory(rakutenItem.itemName);
      const shipJpy = domesticShipping(cat, rakutenItem.postageFlag, rakutenItem.itemName); // 送料別のみ国内送料を原価に算入
      const { profit, profitRate } = calcProfit(rakutenItem.itemPrice, ebayItem.priceJpy, pointAmount, shipJpy);
      if (profitRate <= PROFIT_RATE_FLOOR || profitRate > 300) continue; // 利益率10%以下/異常高は除外
      // 落札seedは価格(=落札額)が確定→現金純利益(ポイント除外＋着地コスト後)でも床を当てる＝配信(applyDisplayProfit)/最終保存(netProfitRate)と一致。
      // 時計など「粗利は出るがポイント大・関税重で現金ネットが薄い/赤字」の品を画像マッチ前に落とす(Anthropic節約＋掲載される品とカタログを一致させ死蔵を防ぐ)。
      if (ebayItem.soldSeed) {
        const netCash = Math.round(profit - pointAmount - landedSubtractJpy(cat, ebayItem.priceJpy / L_USD_JPY));
        const cashBuy = rakutenItem.itemPrice + shipJpy;
        const netRate = cashBuy > 0 ? Math.round((netCash / cashBuy) * 100) : 0;
        if (netRate <= PROFIT_RATE_FLOOR) continue;
      }
      // ② カテゴリ整合: 楽天の推定ジャンルがeBay種ジャンルと明確に食い違う別物は除外（誤ジャンル混入防止）。
      const expectedGenre = EXPECTED_GENRE[ebayItem.category];
      if (expectedGenre && cat !== 'その他' && cat !== expectedGenre) continue;
      // ⑤ 価格比サニティ: eBayが楽天の規定倍率超＝安い部品×高い本体等の誤マッチ疑い→除外。
      if (ebayItem.priceJpy > rakutenItem.itemPrice * PRICE_RATIO_MAX) continue;

      // カード番号/型番が食い違う候補は別商品なので除外（同キャラ別番号カード等の誤マッチ防止）。
      // 画像マッチ前に弾くことで Haiku も節約できる。
      if (codesConflict(rakutenItem.itemName, ebayItem.title)) continue;
      if (accessoryMismatch(rakutenItem.itemName, ebayItem.title)) continue; // 本体↔別売アクセサリ(LEDユニット等)の誤マッチ防止

      // 数量(個数)が食い違う候補は除外（楽天=2本パック vs eBay=単品 等。価格基準が狂うのを防ぐ）。
      // 画像では複数パックも1個に見えるため、タイトルから数値抽出して決定論的に弾く。
      const rQty = quantityOf(rakutenItem.itemName);
      if (rQty !== quantityOf(ebayItem.title)) continue;

      // コスメ/フィギュアは誤マッチが多い(世代/容量/バリエ/プライズ)。確定除外＋画像は確信HIGHのみ採用(確信ゲート)。
      const risky = (cat === 'コスメ' || cat === 'フィギュア' || cat === 'ガンプラ');
      if (risky && sizeMismatch(rakutenItem.itemName, ebayItem.title)) continue; // 容量/サイズ/スケール違いは別物
      if (cat === 'フィギュア' && PRIZE_RE.test(rakutenItem.itemName)) continue;   // プライズ/景品/一番くじ(非可動の安物)を除外

      // ② 利益が出る候補だけ画像マッチ（Haiku→Sonnet）で同一商品か検証。risky は確信HIGHのみ採用。
      if (ebayImg) {
        const matched = await isImageMatch(rakutenImg, ebayImg, { rakutenTitle: rakutenItem.itemName, ebayTitle: ebayItem.title, rakutenQuantity: rQty, strict: risky });
        if (!matched) continue;
      }

      console.log(`  💰 ${profitRate}% | 楽天¥${rakutenItem.itemPrice.toLocaleString()} → eBay¥${ebayItem.priceJpy.toLocaleString()} | ${rakutenItem.itemName.slice(0, 35)}`);

      // coreKeyword: 原則 eBayタイトル。汎用的すぎる(キット名/固有名なし)場合のみ、
      // 楽天タイトルを英訳して差し替える。画像一致済みなので価格は妥当、検索語だけ改善する。
      let coreKeyword = ebayItem.title;
      if (isWeakKeyword(ebayItem.title)) {
        const en = await rakutenTitleToEnglishKeyword(rakutenItem.itemName);
        if (en) coreKeyword = en;
      }

      // 相場の確定。
      // ・落札由来(soldSeed): ebayItem.priceJpy は「実際の落札額」。画像マッチ済み＝この楽天商品とこの落札出品は同一なので、
      //   落札額をそのまま相場に据える（現行出品の最安では上書きしない）＝「確実に実績あり」で確定。利益床は上の①(1303-1304)で確認済み。
      // ・非soldSeed(従来パス・保険): eBay最安値ベースで相場を是正。
      let realAvgPrice = ebayItem.priceJpy, realMedianPrice = ebayItem.priceJpy, realCount = ebayItem.soldCount || 1, finalProfit = profit, finalRate = profitRate;
      if (!ebayItem.soldSeed) {
        const med = await marketMedianPriceJpy(searchQueryFor(coreKeyword), { title: ebayItem.title, rakutenImg, rakutenTitle: rakutenItem.itemName, anchorPriceJpy: ebayItem.priceJpy, rakutenQuantity: rQty });
        if (med && med.count >= 5) {
          const low = med.low ?? med.median;                 // ロバストな最安（旧キャッシュ対策で中央値フォールバック）
          realAvgPrice = Math.min(ebayItem.priceJpy, low);   // ★相場＝eBay最安値ベース
          realMedianPrice = med.median;
          realCount = med.count;
          const r = calcProfit(rakutenItem.itemPrice, realAvgPrice, pointAmount, shipJpy);
          finalProfit = r.profit; finalRate = r.profitRate;
          if (finalRate <= PROFIT_RATE_FLOOR || finalRate > 300) continue; // 利益率10%以下/異常高は除外
        }
      }

      return {
        type: 'profit',
        id: itemId,
        rakutenId: rakutenItem.itemCode,
        product: {
          id: rakutenItem.itemCode,
          title: rakutenItem.itemName,
          imageUrl: rakutenImg,
          images: (rakutenItem.mediumImageUrls ?? []).map(x => x?.imageUrl).filter(Boolean), // 複数画像出品用ギャラリー(最大3)
          category: cat,
          source: {
            site: 'rakuten',
            siteName: '楽天',
            price: rakutenItem.itemPrice,
            url: rakutenItem.itemUrl || rakutenItem.affiliateUrl, // 楽天アフィリ撤退：直リンク(itemUrl)を保存
            pointRate,
            pointAmount,
            shippingJpy: shipJpy,                               // 利益計算に算入済みの国内送料概算
            postageIncluded: Number(rakutenItem.postageFlag) === 0,
          },
          isNew: rakutenItem.itemName.includes('新品') || rakutenItem.itemName.includes('未開封'),
          market: 'EBAY_US',
          coreKeyword,
          ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(coreKeyword)}&LH_Complete=1&LH_Sold=1`,
          realAvgPrice,         // ★落札由来=落札額／従来=eBay最安値ベース（表示・利益の基準）
          realMedianPrice,      // 中央値（併記用・参考）
          realProfit: finalProfit,
          realProfitRate: finalRate,
          realCount,
          // 落札由来は「実際に売れた実績つき」として確定＝serveの掲載ゲート(soldVerified)を満たす（未確定品は載せない）。
          soldBased: ebayItem.soldSeed || false,
          soldVerified: ebayItem.soldSeed || false,        // 画像AIで同一商品の落札を確認済み
          soldUrl: ebayItem.soldSeed ? (ebayItem.itemUrl || undefined) : undefined, // 確認リンク＝実物の落札出品URL
          soldCount30d: ebayItem.soldCount || 0,
          soldWindowDays: ebayItem.soldWindowDays || 0,
          avgDaysToSell: null, // eBay Finding API(落札データ)が廃止のため現状取得不可。Marketplace Insights API(要承認)が必要
          addedAt: new Date().toISOString(), // 登録順ソート用（初回登録時刻、以降不変）
          // 監査(audit_catalog.mjs)が「本番で実際にマッチさせたeBay商品」を採点できるよう保存（精度計測の信頼性）。
          matchedEbayImageUrl: ebayImg || '',
          matchedEbayUrl: ebayItem.itemUrl || '',
          matchedEbayTitle: ebayItem.title || '',
        },
      };
    }

    return { type: 'skip', id: itemId };
  }

  // チャンク単位で並列処理
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const chunk = toProcess.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(item =>
      processEbayItem(item).catch(e => {
        console.error(`  [ERROR] ${item.title.slice(0, 30)}: ${e.message}`);
        return { type: 'skip', id: String(ebayQueryHash(item.title)) };
      })
    ));

    for (const res of results) {
      allCheckedMap.set(res.id, { id: res.id, checkedAt: Date.now() });
      if (res.type !== 'profit') continue;
      // 同一チャンク内で別のeBayタイトルが同じ楽天itemCodeに当たると、並列のexistingIds.hasが
      // 両方すり抜ける。逐次ループ側で live check して重複pushを防ぐ。
      if (existingIds.has(res.rakutenId)) {
        // 既存品に落札由来(soldSeed)のマッチが当たった→「落札確定(soldVerified)」へ昇格。
        // 旧"現行出品ベース"の相場を、画像一致した実売値へ置換＝過大表示を解消し掲載ゲートを通す。
        if (res.product.soldVerified) {
          const ex = profitableProducts.find(p => p.id === res.rakutenId);
          if (ex && !ex.soldVerified) {
            Object.assign(ex, {
              soldBased: true, soldVerified: true,
              soldUrl: res.product.soldUrl, soldCount30d: res.product.soldCount30d, soldWindowDays: res.product.soldWindowDays,
              realAvgPrice: res.product.realAvgPrice, realMedianPrice: res.product.realMedianPrice,
              realProfit: res.product.realProfit, realProfitRate: res.product.realProfitRate, realCount: res.product.realCount,
              matchedEbayImageUrl: res.product.matchedEbayImageUrl, matchedEbayUrl: res.product.matchedEbayUrl, matchedEbayTitle: res.product.matchedEbayTitle,
            });
            const sorted = [...profitableProducts].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
            await kvSet('profitable_products', sorted, 480 * 3600);
          }
        }
        continue;
      }
      existingIds.add(res.rakutenId);
      profitableProducts.push(res.product);
      // 登録順（新着が先頭）で保存。利益率ソートは将来の有料機能としてフロント側で実装
      const sorted = [...profitableProducts].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
      await kvSet('profitable_products', sorted, 480 * 3600);
      await kvSet('last_updated', new Date().toISOString(), 480 * 3600);
    }

    await kvSetPermanent('checked_ids', Array.from(allCheckedMap.values()));

    if (i % 50 === 0 || i + CONCURRENCY >= toProcess.length) {
      console.log(`  進捗: ${Math.min(i + CONCURRENCY, toProcess.length)}/${toProcess.length}件（利益商品: ${profitableProducts.length - existingProducts.length}件）`);
    }
  }

  // ③ 楽天-first 発掘（フラグONのみ）。eBay先が取りこぼす商品を楽天人気起点で拾う。失敗しても本処理は継続。
  if (RAKUTEN_FIRST_ENABLED) {
    try {
      const have = new Set(profitableProducts.map(p => p.id));
      const rf = await processRakutenFirst(have);
      let added = 0;
      for (const prod of rf) { if (!have.has(prod.id)) { profitableProducts.push(prod); have.add(prod.id); added++; } }
      console.log(`  🔁 楽天-first 追加: ${added}件`);
    } catch (e) { console.error(`  [楽天-first ERROR] ${e.message}`); }
  }

  // 仕入れ元(楽天)の実ページ照合（保存直前・復活マージ前＝復活品は運営が意図して戻すので対象外）。
  // 楽天APIで取りこぼす「実は売切」「複数タイプの最安誤認」を実ページで補正する。fail-open。
  try {
    const reconciled = await reconcileSourcePages(profitableProducts);
    profitableProducts.length = 0;
    profitableProducts.push(...reconciled);
  } catch (e) { console.error('  [source-page reconcile ERROR]', e.message); }

  // 手動復活した商品(restored_products)を必ずカタログへ戻す。リフレッシュは毎回カタログを作り直すため、
  // これが無いと運営が手動復活した商品が次のrefreshで消える（出品はpsnapで可能だが検索に出なくなる）。
  // 維持処理の後・保存の直前にマージ＝復活品は除外フィルタを通さず常に残す（運営が意図して戻した商品）。
  try {
    const restored = await kvHgetall('restored_products');
    const have = new Set(profitableProducts.map(p => p.id));
    let merged = 0;
    for (const v of Object.values(restored || {})) {
      let prod; try { prod = typeof v === 'string' ? JSON.parse(v) : v; } catch { continue; }
      if (prod && prod.id && !have.has(prod.id)) { profitableProducts.push(prod); have.add(prod.id); merged++; }
    }
    if (merged) console.log(`  ♻️ 手動復活商品(restored_products)をマージ: ${merged}件`);
  } catch (e) { console.error('restored merge error:', e.message); }

  // ネット利益率(国際送料のeBay手数料＋米国関税を引いた後)が10%以下の商品は「利益商品」に含めない。
  // 表示で隠すのでなく、カタログ自体から外す＝sitemap/商品ページ/topProducts含め一切 利益商品扱いしない。
  // restored(運営が手動復活)は裁量で常に残す（配信 /api/products と同じ扱い）。
  {
    const before = profitableProducts.length;
    const kept = profitableProducts.filter(p => p.restored || netProfitRate(p) > PROFIT_RATE_FLOOR);
    if (kept.length !== before) {
      profitableProducts.length = 0;
      profitableProducts.push(...kept);
      console.log(`  💹 ネット利益率${PROFIT_RATE_FLOOR}%以下を利益商品から除外: ${before - kept.length}件`);
    }
  }
  // 最終保存（登録順・新着が先頭。利益率ソートは将来の有料機能）
  profitableProducts.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  await kvSet('profitable_products', profitableProducts, 480 * 3600);
  await kvSet('last_updated', new Date().toISOString(), 480 * 3600);
  // ※落札AI同一判定は廃止。落札発掘(ebay_sold_seed)→マッチループで「生まれた時点で落札確定(soldVerified)」になるため不要。
  await kvArchiveProducts(profitableProducts); // 出品アーカイブを更新（カタログ落ち後も仕入れた人が出品できるように）
  await kvSetPermanent('checked_ids', Array.from(allCheckedMap.values()));
  await kvSet('refresh_stats', {
    ebayJpCount: ebayJpItems.length,
    processedCount: toProcess.length,
    existingCount: existingProducts.length,
    newCount: Math.max(0, profitableProducts.length - existingProducts.length), // 実ページ照合で既存品が落ちると負になり得るのでクランプ
    profitableCount: profitableProducts.length,
    haikuCalls: haikuCallsToday,
    haikuFail: haikuFailToday,
    sonnetCalls: sonnetCallsToday,
    priceVerify: priceVerifyToday, // 相場の最安を画像確定した回数（コスト観測・予算PRICE_VERIFY_BUDGET内）
    elapsedMin: Math.round((Date.now() - startedAt) / 60000),
    runAt: new Date().toISOString(),
  }, 480 * 3600);
  // 観測フック: 照合(Anthropic)の健康状態を専用キーにも残す（/api やレポートから参照しやすく）。
  await kvSet('match_health', {
    haiku: haikuCallsToday, sonnet: sonnetCallsToday, haikuFail: haikuFailToday,
    down: haikuFailToday > 0 && haikuCallsToday === 0,
    runAt: new Date().toISOString(),
  }, 480 * 3600);

  // 観測フック: Haikuが全滅(成功0/失敗あり)＝Anthropic到達不可。未検証のまま商品が通る(fail-open)危険状態なのでCIログで目立たせる。
  if (haikuFailToday > 0 && haikuCallsToday === 0) {
    console.log(`
⚠️⚠️ 照合DOWN: Haiku成功0 / 失敗${haikuFailToday}回 → Anthropic到達不可。未検証のまま商品が通る(fail-open)状態。
   → ANTHROPIC_API_KEY / クレジット残高 / レート制限を確認してください。`);
  } else if (haikuFailToday > 0) {
    console.log(`  ⚠️ 照合の一部でHaiku不通: 失敗${haikuFailToday}回（その分は保留=fail-open）`);
  }

  console.log(`
✨ 完了!
  eBay売れ済み: ${ebayJpItems.length}件
  処理: ${toProcess.length}件
  新規利益商品: ${Math.max(0, profitableProducts.length - existingProducts.length)}件
  DB合計: ${profitableProducts.length}件（480時間TTL）
  画像判定(Claude): Haiku 成功${haikuCallsToday}/不通${haikuFailToday}回 / Sonnet確認 ${sonnetCallsToday}回
  所要時間: ${Math.round((Date.now() - startedAt) / 60000)}分
`);
}

main().catch(e => { console.error(e); process.exit(1); });
