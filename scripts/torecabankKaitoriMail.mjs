// トレカバンクの「本日の買取表」から抽出して【毎日フルリスト】をメールする（ユーザー指示2026-07-11。旧・月曜リスト＋火〜日金額の2モード制は廃止）:
//   残り点数の下限は買取額で段階(50万↑=20点/未満=一律MIN_REMAINING(30)点)・MAX_PRICE(既定0=上限なし)・BOX除外 のリストを毎日送信。
//   各行に【前日比＝前日からいくらプラスになったか】を表示し、値上がり→値下がり→変動なし→NEW の順に並べる。
// 依存ゼロ（Node18+ の fetch のみ）。データはページHTMLの `const allProducts = [...]` 埋め込みを取るだけ＝APIキー/ブラウザ不要。
//
// 価格履歴: 毎回 全商品の買取額を KV `tb_price_snap:YYYY-MM-DD`(JST)に1日1キー保存。前日/前週比の基準に使う。
// 送信は Resend。RESEND_API_KEY 未設定 or `--dry` ならプレビューのみ（非破壊）。cron2系統の二重送信は tb_sent:{date} で防ぐ。
//
// env:
//   RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可) / MAIL_BCC(Bcc・カンマ区切り可)
//   MIN_REMAINING   リストの残り点数の下限（既定: 50）
//   MAX_PRICE       買取額の上限・円（0=上限なし。既定0＝ユーザー指示2026-07-09で5万上限を解除）
//   EXCLUDE_BOX     "0"で未開封BOXも含める（既定はBOX除外）
//   KV_REST_API_URL / KV_REST_API_TOKEN   価格履歴＋送信済みガード
//   FORCE_SEND      "1"で本日送信済みガードを無視して必ず送る（手動再送）
//
// 使い方: node scripts/torecabankKaitoriMail.mjs [--dry] [--force]

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const SOURCE_URL = "https://store.torecabank.com/kaitori_list";
const BASE = "https://store.torecabank.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MIN_REMAINING = Number(process.env.MIN_REMAINING || 5); // 残り点数の下限（全金額帯で一律）
// 2026-07-26ユーザー指示「点数は全金額で5件以上あればリスト化していい」＝買取額での段階制(50万↑20点/10万↑30点)を廃止し一律5点以上に。
const minRemainFor = () => MIN_REMAINING;
const MAX_PRICE = Number(process.env.MAX_PRICE) || 0; // 買取額の上限（円）。0=上限なし（ユーザー指示2026-07-09: 5万上限を解除）
const MIN_PRICE = Number(process.env.MIN_PRICE ?? 30000); // 買取額の下限（円）。これ以下は掲載しない。2026-07-26ユーザー指示「3万以下はリストに上げない」。0=下限なし
// 対象カテゴリ（トレカバンクの category_id）。実データ確認: 1=ポケモン(572件)/2=ワンピース(52)/3=遊戯王(159)/4=ホロライブ等(149)。
// 2026-07-29ユーザー指示「ポケモンだけに絞って」＝既定"1"。複数入れる時はカンマ区切り(例 TB_CATEGORY_IDS="1,3")。
const CATEGORY_IDS = String(process.env.TB_CATEGORY_IDS ?? "1").split(",").map((s) => s.trim()).filter(Boolean);
const CAT_LABEL = { 1: "ポケモン", 2: "ワンピース", 3: "遊戯王", 4: "ホロライブ等" };
const categoryLabel = CATEGORY_IDS.map((id) => CAT_LABEL[id] || `cat${id}`).join("/") + "のみ";
const EXCLUDE_BOX = process.env.EXCLUDE_BOX !== "0"; // 既定=未開封BOX除外
const MAIL_FROM = process.env.MAIL_FROM || "トレカバンク買取ウォッチ <noreply@yushutsu-fukugyo.com>";
const parseAddrs = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const MAIL_TO = process.env.MAIL_TO || "chikara0323@gmail.com";
const MAIL_BCC = process.env.MAIL_BCC || "m08h22@icloud.com"; // 既定に追加宛先(Bcc)を入れる＝Vercel Cron経由でも両方に届く(GitHub workflowはenvで上書き)
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;
const FORCE = process.argv.includes("--force") || process.env.FORCE_SEND === "1";

const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_ON = Boolean(KV_URL && KV_TOKEN);
const SNAP_KEY = (day) => `tb_price_snap:${day}`;
const SNAP_TTL = 14 * 24 * 60 * 60;
const SENT_KEY = (day) => `tb_sent:${day}`;
const SENT_TTL = 2 * 24 * 60 * 60;

// JSTの曜日/日付。cronはUTCだが、この時点の実時刻をJSTに寄せて判定する（10:00JST=01:00UTCでも正しい日付/曜日が出る）。
const jstNow = () => new Date(Date.now() + 9 * 3600e3);
const jstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const WD_LABEL = ["日", "月", "火", "水", "木", "金", "土"][jstNow().getUTCDay()];

const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
const priceCapLabel = MAX_PRICE > 0 ? `買取${yen(MAX_PRICE)}以下・` : ""; // 上限ありの時だけ表示（0=無制限は表示しない）
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const keyOf = (p) => `${p.product_type_name}|${p.product_master_key1}|${p.product_master_key2}|${p.product_master_name}`;
const gradeBadge = (g) => `<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;color:#fff;background:${/BOX/i.test(g) ? "#0d9488" : "#A98B5C"}">${esc(g)}</span>`;
// 相場照合ボタン（タップで検索が開く）。メールはJS不可なので"コピー"は無理→検索リンクで代替。
// 括弧/角括弧はスペース化して素直な検索語にする（例「(PSA10)リザードンVMAX[S8b]」→「PSA10 リザードンVMAX S8b」）。
const cleanKw = (name) => String(name || "").replace(/[()（）\[\]【】]/g, " ").replace(/\s+/g, " ").trim();
// 商品名からカード名部分だけを抜く(ユーザー指示2026-07-12)。「(PSA10)イーブイ[S8b]」→「イーブイ」＝
// 先頭の(グレード)接頭辞を除去→セット記号[S8b]/補足括弧(マクドナルド等)/エディション(:1ED)以降を落とす。
const cardName = (name) => String(name || "").replace(/^[(（][^)）]*[)）]/, "").split(/[\[［(（:：]/)[0].trim();
// 両検索とも「販売中のみ＋価格の安い順」で開く(ユーザー指示2026-07-11)。param名は実ブラウザで操作して実測。
// メルカリは【カード名+型番+グレード】で検索(ユーザー指示2026-07-12。例「イーブイ 210/184 PSA10」)＝個体がほぼ一意に当たる。
// 型番なしの商品だけ名前検索にフォールバック。
const mercariSearch = (q) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=on_sale&sort=price&order=asc`;
const mercariUrl = (p) => {
  const nm = cardName(p.product_master_name);
  return mercariSearch(p.product_master_key2 && nm ? `${nm} ${p.product_master_key2} ${p.product_type_name}` : cleanKw(p.product_master_name));
};
// スニダン(スニーカーダンク)=トレカ相場の照合先。検索paramは keywords(複数形)＝実ブラウザで検証済(単数 keyword だと既定ページに落ちる)。
const snkrdunkUrl = (name) => `https://snkrdunk.com/search?keywords=${encodeURIComponent(cleanKw(name))}&isSaleOnly=true&sort=price_low`;
// 小さなボタン(チップ)は buildListHtml 内の .btn class で描画(ユーザー指示「小さく収まるボタンに」)。
// 11px(Gmailのfont boosting対象になりにくい)＋ボタン専用行に分離＝多少拡大されても崩れない。色: メルカリ=赤/スニダン=黒。

// ── トレカラウンジ(かんたん郵送買取)の照合 ──────────────────────────────
// ユーザー指示2026-07-13: ①TBよりラウンジが高い商品だけ行内に緑で明示 ②TBに無い商品は末尾の別セクションに追加。
// (前回の全行「ラ ¥X」併記は「醜い」で撤回済み→高い時だけ＋別セクションの控えめ設計に変更)
// kaitori.toreca-lounge.com/products/pokemon はNext.js SSR(Vercelホスト・bot壁なし)。商品データはRSC flight
// (self.__next_f.push([1,"..."]))内のJSONに埋め込み＝ページを取ってパースするだけ(実測 約11ページ/約890商品)。
// 照合=「型番|グレード」(TBのproduct_master_key2 × TLのmodelNumber)＋【カード名の一致検証】。
// ⚠TLのmodelNumberはセットコード無しの番号だけ＝別セットの同番号カードと衝突する(敵対レビュー実測: 衝突70キー)。
// →同キーは配列で持ち、TLカード名(括弧/空白前の基本名)がTB商品名に含まれる候補だけ採用・価格が割れたら不採用。
const TL_BASE = "https://kaitori.toreca-lounge.com/products/pokemon";
function parseLoungeProducts(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1]));
  const flight = chunks.join("");
  const out = [];
  let i = 0;
  const marker = '{"productFormat"';
  while ((i = flight.indexOf(marker, i)) !== -1) {
    let d = 0, end = -1, inS = false, escChar = false;
    for (let p = i; p < flight.length; p++) {
      const c = flight[p];
      if (inS) { if (escChar) escChar = false; else if (c === "\\") escChar = true; else if (c === '"') inS = false; continue; }
      if (c === '"') { inS = true; continue; }
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) { end = p; break; } }
    }
    if (end < 0) break;
    try { out.push(JSON.parse(flight.slice(i, end + 1))); } catch { /* 壊れた断片はスキップ */ }
    i = end + 1;
  }
  return out;
}
// カード名の基本形＝括弧/空白以降を落とす(NFKC)。「ピカチュウ(25th)」→「ピカチュウ」「メガガルーラex SAR」→「メガガルーラex」。
const tlBaseName = (name) => String(name || "").normalize("NFKC").split(/[\s(（\[【]/)[0].trim();
// 全ページ取得。map=「型番|グレード」→候補配列[{base,price}](TB行の照合用)、products=TL全商品(TBに無い物の抽出用)。
// 失敗してもメール自体は止めない(fail-open=ラウンジ情報なしで送る)。
async function fetchLounge() {
  const map = new Map();
  const products = [];
  const seen = new Set();
  const deadline = Date.now() + 35000; // Vercelルート(maxDuration60s)内に収める保険。途中まででも取れた分は使う。
  try {
    for (let page = 1; page <= 40 && Date.now() < deadline; page++) {
      const r = await fetch(`${TL_BASE}?page=${page}`, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      const prods = parseLoungeProducts(await r.text());
      let fresh = 0; // 範囲外pageは最終ページにクランプされて同内容が返る(実測)＝新規商品0で終端を検知する
      for (const p of prods) {
        const id = p.productId || p.publicId;
        if (!id || seen.has(id)) continue;
        seen.add(id); fresh++;
        const base = tlBaseName(p.productName);
        // 型番の飾りを除去して照合キーに使う(「031/095（型番不問）」→「031/095」。飾り付きはTBのkey2と絶対一致しないため)。
        const model = String(p.modelNumber || "").split(/[(（]/)[0].trim();
        if (!base) continue;
        for (const g of p.grades || []) {
          const key = `${model}|${g.grade}`;
          const price = Number(g.buyPrice);
          if (!(price > 0)) continue;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ base, price });
          products.push({ base, name: p.productName, modelNumber: model, grade: g.grade, price, imageUrl: p.imageUrl });
        }
      }
      if (!fresh) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.log(`[lounge] トレカラウンジ ${seen.size}商品取得`);
  } catch (e) { console.warn("[lounge] 取得失敗（ラウンジ情報なしで続行）:", e.message); }
  return { map, products };
}
// TB商品1件に対するラウンジ価格。名前一致で衝突候補を絞り、それでも価格が割れたら null。
function loungePriceFor(p, tlMap) {
  const cands = tlMap.get(`${p.product_master_key2}|${p.product_type_name}`);
  if (!cands || !cands.length) return null;
  const tbName = String(p.product_master_name || "").normalize("NFKC").replace(/\s+/g, "");
  const hit = cands.filter((c) => tbName.includes(c.base));
  if (!hit.length) return null;
  const prices = [...new Set(hit.map((c) => c.price))];
  return prices.length === 1 ? prices[0] : null;
}
// TBに無いTL商品(PSA10のみ・BOXは対象外方針)。TB全商品の「型番|グレード」逆引き＋名前で存在判定し、無い物を高額順に。
// 存在判定の名前一致は【双方向】: TB商品名⊇TL基本名(通常) または TL基本名⊇TBカード名(TBが接尾語を落とす例:
// TB「ソルガレオ&ルナアーラ」vs TL「…GX」/ TBがコラボ名を括弧に出す例: TB「モクロー(ムンク展)」vs TL「ムンクモクロー」)。
// ※価格を表示する loungePriceFor は誤帰属(別カードの価格を出す)防止のため片方向のまま＝「載せ漏れ」より「誤情報」を避ける。
function loungeOnlyItems(tlProducts, tbAll) {
  const tbIdx = new Map();
  for (const p of tbAll) {
    const key = `${p.product_master_key2}|${p.product_type_name}`;
    if (!tbIdx.has(key)) tbIdx.set(key, []);
    tbIdx.get(key).push({
      full: String(p.product_master_name || "").normalize("NFKC").replace(/\s+/g, ""),
      card: cardName(p.product_master_name).normalize("NFKC").replace(/\s+/g, ""),
    });
  }
  const dedup = new Map(); // 同一カード(base|型番)の重複は高い方
  for (const t of tlProducts) {
    if (t.grade !== "PSA10") continue;
    if (!t.modelNumber) continue; // 型番なし=「最低保証」等のカードでない疑似商品・照合不能のため対象外
    if (!(Number(t.price) > MIN_PRICE)) continue; // 買取下限(既定3万円超)を本体リストと統一(2026-07-26ユーザー指示)
    const names = tbIdx.get(`${t.modelNumber}|${t.grade}`);
    if (names && names.some((n) => n.full.includes(t.base) || (n.card.length >= 3 && t.base.includes(n.card)))) continue; // TBにある
    const k = `${t.base}|${t.modelNumber}`;
    if (!dedup.has(k) || dedup.get(k).price < t.price) dedup.set(k, t);
  }
  return [...dedup.values()].sort((a, b) => b.price - a.price);
}

async function kvCmd(cmd) {
  const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`KV ${cmd[0]} ${r.status}`);
  return (await r.json()).result;
}

function extractProducts(html) {
  const marker = "const allProducts = ";
  const i = html.indexOf(marker);
  if (i < 0) throw new Error("allProducts marker not found（サイト構造が変わった可能性）");
  const start = html.indexOf("[", i);
  let depth = 0, inStr = false, escChar = false, end = -1;
  for (let p = start; p < html.length; p++) {
    const c = html[p];
    if (inStr) { if (escChar) escChar = false; else if (c === "\\") escChar = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) throw new Error("allProducts array end not found");
  return JSON.parse(html.slice(start, end + 1));
}

// 2値の差分セル（今日 vs 基準）。上昇=緑▲ / 下落=赤▼ / 同=灰。基準がnull=—。
function deltaSpan(today, base) {
  if (base == null) return `<span style="color:#cbd5e1">—</span>`;
  const d = Number(today) - Number(base);
  if (d === 0) return `<span style="color:#9ca3af">±0</span>`;
  const up = d > 0;
  return `<span style="color:${up ? "#16a34a" : "#ef4444"};font-weight:700">${up ? "▲ +" : "▼ -"}${yen(Math.abs(d))}</span>`;
}

// 毎日のリスト（買取額＋残り点数＋前日比を強調＋前週比）。rowsは値上がり→値下がり→変動なし→NEW順に並び済み前提。
// ラウンジ情報(ユーザー指示2026-07-13)は控えめに: TBより高い行だけ緑の1行＋TBに無い商品は末尾の紫セクション。
// ⚠設計制約(2026-07-11ユーザー報告「画像と名前がずれている」への対策・崩すな):
//  ①全<td>と<img>は vertical-align:top ＝画像を必ず自分の行の商品名の高さに固定(既定middleだと縦長行で画像が
//    下の商品側へ沈んで見える) ②繰り返しスタイルは<style>のclassへ・行HTMLは改行なし＝78件でも約60KBに収まり
//    Gmailの102KB切り詰め(超えると途中でぶった切られ表示が崩れる)を回避。GmailはヘッダやclassのCSSに対応済み。
function buildListHtml(rows, meta, weekMap, tlOnly) {
  const up = rows.filter((r) => r.diff > 0).length, down = rows.filter((r) => r.diff < 0).length, fresh = rows.filter((r) => r.diff == null).length;
  const tlHigher = rows.filter((r) => r.tl != null && r.tl > Number(r.p.buy_price)).length;
  const css = `
    .wrap{font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B;-webkit-text-size-adjust:100%;text-size-adjust:100%}
    .tbl{width:100%;border-collapse:collapse}
    .tbl td{padding:8px 6px;border-bottom:1px solid #eee;vertical-align:top}
    .ic{width:56px}
    .ic img{width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f3f4f6;vertical-align:top}
    .nm{font-size:13px;font-weight:700;line-height:1.4}
    .sb{font-size:11px;color:#9ca3af;margin-top:3px}
    .bt{margin-top:5px}
    .pr{text-align:right;white-space:nowrap}
    .p1{font-size:14px;font-weight:800}
    .p2{font-size:11px;margin-top:2px}
    .rm{font-size:11px;color:#ef4444;font-weight:700}
    .wk{font-size:10px;color:#9ca3af}
    .btn{display:inline-block;padding:1px 8px;border-radius:9px;color:#ffffff !important;font-size:11px;line-height:1.5;font-weight:700;text-decoration:none;white-space:nowrap}
    .lg{font-size:11px;color:#16a34a;font-weight:700}
    .tlh{font-size:14px;margin:20px 0 2px;color:#7c3aed}
    .tls{font-size:11px;color:#6b7280;margin:0 0 6px}
    .tlpr{font-size:14px;font-weight:800;color:#7c3aed}
  `.replace(/\s+/g, " ");
  const head = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div class="wrap">
      <h2 style="font-size:17px;margin:0 0 4px">トレカバンク 買取リスト</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6">
        ${meta.date}(${WD_LABEL}) 時点 ／ 対象 <b>${rows.length}件</b>（${categoryLabel}・残り${MIN_REMAINING}点↑・買取${yen(MIN_PRICE)}超・${priceCapLabel}${EXCLUDE_BOX ? "未開封BOX除外" : "BOX含む"}）<br>
        <span style="color:#16a34a;font-weight:700">▲上昇 ${up}</span> ／ <span style="color:#ef4444;font-weight:700">▼下落 ${down}</span>${fresh ? ` ／ NEW ${fresh}` : ""} 件（前日比・<b>値上がり→値下がり→変動なし順</b>）<br>
        ${tlHigher ? `<span class="lg">緑「ラウンジ ¥…▲」=トレカラウンジ(郵送)の方が買取が高い ${tlHigher}件</span><br>` : ""}
        ※ グレード品(PSA10等)の買取額は鑑定済み前提。Mercariで仕入れる際はグレードを合わせること。
      </p>`;
  const body = rows.map(({ p, diff, tl }) => {
    const img = BASE + String(p.image_path || "").replace(/^\/+/, "");
    const sub = [p.product_master_key1, p.product_master_key2].filter(Boolean).join(" ");
    const k = keyOf(p);
    const nm = p.product_master_name;
    return `<tr><td class="ic"><img src="${esc(img)}" alt="" width="52" height="52"></td>` +
      `<td><div class="nm">${esc(nm)}</div>${sub ? `<div class="sb">${esc(sub)}</div>` : ""}` +
      `<div class="bt"><a class="btn" href="${mercariUrl(p)}" style="background:#FA5252">メルカリ🔍</a> <a class="btn" href="${snkrdunkUrl(nm)}" style="background:#111827">スニダン🔍</a></div></td>` +
      `<td class="pr"><div class="p1">${yen(p.buy_price)}</div>` +
      `<div class="p2">前日比 ${diff == null ? `<span style="color:#0d9488;font-weight:700">NEW</span>` : deltaSpan(Number(p.buy_price), Number(p.buy_price) - diff)}</div>` +
      `<div class="rm">残${esc(p.remaining_quantity)}点</div>` +
      (tl != null && tl > Number(p.buy_price) ? `<div class="lg">ラウンジ ${yen(tl)} ▲</div>` : "") +
      `<div class="wk">前週 ${deltaSpan(p.buy_price, weekMap ? weekMap[k] : null)}</div></td></tr>`;
  }).join("");
  // トレカバンクに無い・トレカラウンジのみの商品(高額順・上限あり)。
  let tlSection = "";
  if (tlOnly && tlOnly.items.length) {
    const tlBody = tlOnly.items.map((t) => {
      const q = `${t.base} ${t.modelNumber} PSA10`;
      return `<tr><td class="ic"><img src="${esc(t.imageUrl || "")}" alt="" width="52" height="52"></td>` +
        `<td><div class="nm">${esc(t.name)}</div><div class="sb">${esc(t.modelNumber)} PSA10</div>` +
        `<div class="bt"><a class="btn" href="${mercariSearch(q)}" style="background:#FA5252">メルカリ🔍</a> <a class="btn" href="${snkrdunkUrl(`PSA10 ${t.base}`)}" style="background:#111827">スニダン🔍</a></div></td>` +
        `<td class="pr"><div class="tlpr">${yen(t.price)}</div><div class="wk">ラウンジ買取</div></td></tr>`;
    }).join("");
    tlSection = `<h3 class="tlh">🟣 トレカラウンジのみ買取中（トレカバンク未掲載）</h3>
      <p class="tls">該当 <b>${tlOnly.total}件</b>${tlOnly.total > tlOnly.items.length ? ` 中 高額順 ${tlOnly.items.length}件を表示` : ""} ／ <a href="${TL_BASE}" style="color:#7c3aed">トレカラウンジ(郵送買取)</a>・枚数制限なしの物が多い</p>
      <table class="tbl">${tlBody}</table>`;
  }
  return `${head}<table class="tbl">${body}</table>${tlSection}
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">出典: <a href="${SOURCE_URL}" style="color:#6b7280">store.torecabank.com/kaitori_list</a> ／ <a href="${TL_BASE}" style="color:#9ca3af">kaitori.toreca-lounge.com</a>（自動取得）</p></div></body></html>`;
}

async function sendMail(subject, html) {
  const toList = parseAddrs(MAIL_TO), bccList = parseAddrs(MAIL_BCC);
  const payload = { from: MAIL_FROM, to: toList, subject, html };
  if (bccList.length) payload.bcc = bccList;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Resend send failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  console.log(`[torecabank] 送信完了 → to:${toList.join(",")}${bccList.length ? " / bcc:" + bccList.join(",") : ""}`);
  if (KV_ON) { try { await kvCmd(["SET", SENT_KEY(jstDay(0)), "1", "EX", String(SENT_TTL)]); } catch (e) { console.warn("[guard] 送信済み記録に失敗:", e.message); } }
}

export async function main() {
  // 本日送信済みガード（自動実行のみ。cron2本目/再実行の二重送信を防ぐ）。
  if (!DRY && !FORCE && KV_ON) {
    try { const already = await kvCmd(["GET", SENT_KEY(jstDay(0))]); if (already) { console.log(`[torecabank] 本日分は送信済み＝スキップ`); return; } } catch (e) { console.warn("[guard] 送信済み確認に失敗（続行）:", e.message); }
  }

  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const all = extractProducts(await res.text());
  const todayMap = {}; for (const p of all) todayMap[keyOf(p)] = Number(p.buy_price); // スナップショット用（key→価格）
  // 表示日付は「実時刻」にtimeZone指定で整形する。jstNow()(既に+9h済み)に更にtimeZone:'Asia/Tokyo'を掛けると
  // 二重シフトで15:00 JST以降+1日ズレる(敵対レビューで実機再現)ため、ここではjstNow()を使わないこと。
  const date = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

  // 前日/前週の価格スナップショットを読む（前日比/前週比の基準）＋トレカラウンジ全商品。
  let prevMap = null, weekMap = null;
  if (KV_ON) {
    try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-1))]); prevMap = v ? JSON.parse(v) : null; } catch { /* noop */ }
    try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-7))]); weekMap = v ? JSON.parse(v) : null; } catch { /* noop */ }
  }
  const tl = await fetchLounge();

  // 対象抽出＋前日比を付与し、値上がり→値下がり→変動なし→NEW順に（各グループ内は変動幅/金額の大きい順）。
  const grp = (r) => (r.diff == null ? 3 : r.diff > 0 ? 0 : r.diff < 0 ? 1 : 2);
  const rows = all
    .filter((p) => CATEGORY_IDS.includes(String(p.category_id)) && Number(p.remaining_quantity) >= minRemainFor(Number(p.buy_price)) && Number(p.buy_price) > MIN_PRICE && (MAX_PRICE <= 0 || Number(p.buy_price) <= MAX_PRICE) && !(EXCLUDE_BOX && /BOX/i.test(p.product_type_name)))
    .map((p) => { const base = prevMap ? prevMap[keyOf(p)] : null; return { p, diff: base == null ? null : Number(p.buy_price) - Number(base), tl: loungePriceFor(p, tl.map) }; })
    .sort((a, b) => {
      if (grp(a) !== grp(b)) return grp(a) - grp(b);                    // グループ順(値上がり→値下がり→変動なし→NEW)
      if (grp(a) === 0) return b.diff - a.diff;                          // 値上がり: 上昇の大きい順
      if (grp(a) === 1) return a.diff - b.diff;                          // 値下がり: 下落の大きい順
      return Number(b.p.buy_price) - Number(a.p.buy_price);              // 変動なし/NEW: 金額の高い順
    });
  const up = rows.filter((r) => r.diff > 0).length, down = rows.filter((r) => r.diff < 0).length;
  // トレカバンクに無い・ラウンジのみの商品(高額順)。メールはGmailの102KB切り詰めがあるため表示は上位までに絞る。
  const TL_ONLY_MAX = 25;
  const tlOnlyAll = loungeOnlyItems(tl.products, all);
  const tlHigher = rows.filter((r) => r.tl != null && r.tl > Number(r.p.buy_price)).length;
  console.log(`[torecabank] 毎日リスト: ${categoryLabel}・残り${MIN_REMAINING}点↑・買取${yen(MIN_PRICE)}超・${priceCapLabel || "上限なし・"}${EXCLUDE_BOX ? "BOX除外" : ""} → ${rows.length}件（▲${up} ▼${down}）／ ラウンジ高${tlHigher}件・ラウンジのみ${tlOnlyAll.length}件`);

  let html2 = buildListHtml(rows, { date }, weekMap, { items: tlOnlyAll.slice(0, TL_ONLY_MAX), total: tlOnlyAll.length });
  // Gmailは102KB超を切り詰めて表示が崩れる→超えそうならラウンジのみセクションを削って本体リストを守る。
  if (Buffer.byteLength(html2, "utf8") > 98000) {
    html2 = buildListHtml(rows, { date }, weekMap, { items: [], total: 0 });
    console.warn("[torecabank] 102KB接近のためラウンジのみセクションを省略");
  }
  const subject = `【トレカバンク】買取リスト ${rows.length}件 ▲${up} ▼${down}（${date} ${WD_LABEL}）`;

  // 価格スナップショット保存（毎日・1キー）。翌日の前日比の基準になる。
  if (KV_ON && !DRY) { try { await kvCmd(["SET", SNAP_KEY(jstDay(0)), JSON.stringify(todayMap), "EX", String(SNAP_TTL)]); console.log(`[kv] スナップショット保存 ${SNAP_KEY(jstDay(0))}（${Object.keys(todayMap).length}件）`); } catch (e) { console.warn("[kv] スナップショット保存失敗:", e.message); } }

  if (DRY) { fs.writeFileSync("torecabank_preview.html", html2); console.log(`[dry] プレビュー出力 / 件名: ${subject}`); rows.slice(0, 5).forEach(({ p, diff }) => console.log(`  ${yen(p.buy_price)} 前日比${diff == null ? "NEW" : (diff >= 0 ? "+" : "") + diff} 残${p.remaining_quantity}点 ${p.product_master_name}`)); return; }
  await sendMail(subject, html2);
}

// CLI(node scripts/torecabankKaitoriMail.mjs)として直接実行された時だけ自動実行する。
// APIルート(Vercel Cron)からimportした時は main() を呼ばない＝関数として再利用できる。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[torecabank] エラー:", e.message); process.exit(1); });
}
