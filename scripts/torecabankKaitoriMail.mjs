// トレカバンクの「本日の買取表」から抽出して【毎日フルリスト】をメールする（ユーザー指示2026-07-11。旧・月曜リスト＋火〜日金額の2モード制は廃止）:
//   残り点数の下限は買取額で段階(50万↑=20点/10万↑=30点/未満=MIN_REMAINING(50)点)・MAX_PRICE(既定0=上限なし)・BOX除外 のリストを毎日送信。
//   各行に【前日比＝前日からいくらプラスになったか】を表示し、値上がり→値下がり→変動なし→NEW の順に並べる。
//   各行に【トレカラウンジ(郵送買取)の買取価格】も併記(2026-07-11)＝ラウンジは枚数制限がない物が多く売り先の比較になる。TBより高ければ緑▲。
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
const MIN_REMAINING = Number(process.env.MIN_REMAINING || 50); // 残り点数下限の基本値（買取10万円未満に適用）
// 残り点数の下限は買取額で段階化（ユーザー指示2026-07-11）: 50万円以上=20点 / 10万円以上=30点 / それ未満=MIN_REMAINING(50)点。
// 高額品は残りが少なくても1点の妙味が大きいため下限を緩める。
const minRemainFor = (price) => (price >= 500000 ? 20 : price >= 100000 ? 30 : MIN_REMAINING);
const MAX_PRICE = Number(process.env.MAX_PRICE) || 0; // 買取額の上限（円）。0=上限なし（ユーザー指示2026-07-09: 5万上限を解除）
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
// 相場照合ボタン（タップでその商品名の検索が開く）。メールはJS不可なので"コピー"は無理→検索リンクで代替。
// 括弧/角括弧はスペース化して素直な検索語にする（例「(PSA10)リザードンVMAX[S8b]」→「PSA10 リザードンVMAX S8b」）。両検索で同じ検索語を使う。
const cleanKw = (name) => String(name || "").replace(/[()（）\[\]【】]/g, " ").replace(/\s+/g, " ").trim();
// 両検索とも「販売中のみ＋価格の安い順」で開く(ユーザー指示2026-07-11)。param名は実ブラウザで操作して実測。
const mercariUrl = (name) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(cleanKw(name))}&status=on_sale&sort=price&order=asc`;
// スニダン(スニーカーダンク)=トレカ相場の照合先。検索paramは keywords(複数形)＝実ブラウザで検証済(単数 keyword だと既定ページに落ちる)。
const snkrdunkUrl = (name) => `https://snkrdunk.com/search?keywords=${encodeURIComponent(cleanKw(name))}&isSaleOnly=true&sort=price_low`;
// チップ(背景付きボタン)はGmailアプリのfont boosting(小さい文字の強制拡大)で膨らんで行からはみ出す→素のテキストリンクに(2026-07-11)。
// サブ行と同じ11pxならboostされず、テキストとして自然に流れる＝崩れない。色で判別(メルカリ=赤/スニダン=黒)。
const linkStyle = (color) => `color:${color} !important;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap`;
const mercariBtn = (name) => `<a href="${mercariUrl(name)}" style="${linkStyle("#FA5252")}">メルカリ🔍</a>`;
const snkrdunkBtn = (name) => `<a href="${snkrdunkUrl(name)}" style="${linkStyle("#111827")};margin-left:6px">スニダン🔍</a>`;

// ── トレカラウンジ(かんたん郵送買取)の買取価格 ──────────────────────────────
// ユーザー指示2026-07-11: トレカバンクは買取枠(残り点数)があるが、ラウンジは枚数制限がない物が多い＝売り先として各行に併記。
// kaitori.toreca-lounge.com/products/pokemon はNext.js SSR(Vercelホスト・bot壁なし)。商品データはRSC flight
// (self.__next_f.push([1,"..."]))内のJSONに埋め込み＝ページを取ってパースするだけ(実測 約10ページ/約890商品)。
// 照合=「型番|グレード」(TBのproduct_master_key2 × TLのmodelNumber。例"119/114|PSA10")＋【カード名の一致検証】。
// ⚠TLのmodelNumberはセットコード無しの番号だけ＝別セットの同番号カードと衝突する(敵対レビュー実測: 衝突70キー・
// 照合ヒットの10%が別カードの価格を拾っていた)。→同キーは配列で持ち、TLカード名(括弧前の基本名)がTB商品名に
// 含まれる候補だけ採用・候補の価格が割れたら採用しない(誤った高値で郵送させるより「—」が正しい)。
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
// TLは名前の後ろに空白+レアリティ(SAR等)を付けることがあり、括弧だけの切り出しだと名前一致に落ちるため空白でも切る。
const tlBaseName = (name) => String(name || "").normalize("NFKC").split(/[\s(（\[【]/)[0].trim();
// 全ページ取得→「型番|グレード」→候補配列[{base,price}]のMap。失敗してもメール自体は止めない(fail-open=ラウンジ欄が—になるだけ)。
async function fetchLoungeMap() {
  const map = new Map();
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
        for (const g of p.grades || []) {
          const key = `${p.modelNumber}|${g.grade}`;
          const price = Number(g.buyPrice);
          if (!(price > 0) || !base) continue;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ base, price });
        }
      }
      if (!fresh) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    console.log(`[lounge] トレカラウンジ価格 ${seen.size}商品/${map.size}キー取得`);
  } catch (e) { console.warn("[lounge] 取得失敗（ラウンジ欄なしで続行）:", e.message); }
  return map;
}
// TB商品1件に対するラウンジ価格。名前一致で衝突候補を絞り、それでも価格が割れたら null(=「—」表示)。
function loungePriceFor(p, tlMap) {
  const cands = tlMap.get(`${p.product_master_key2}|${p.product_type_name}`);
  if (!cands || !cands.length) return null;
  const tbName = String(p.product_master_name || "").normalize("NFKC").replace(/\s+/g, "");
  const hit = cands.filter((c) => tbName.includes(c.base));
  if (!hit.length) return null;
  const prices = [...new Set(hit.map((c) => c.price))];
  return prices.length === 1 ? prices[0] : null;
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

// ラウンジ価格セル。トレカバンクより高い時は緑で強調（=枚数制限のないラウンジに売る方が高い）。
function loungeCell(tl, tbPrice) {
  if (tl == null) return `<span style="color:#cbd5e1">—</span>`;
  const higher = tl > Number(tbPrice);
  return `<span style="${higher ? "color:#16a34a;font-weight:700" : "color:#6b7280"}">${yen(tl)}${higher ? " ▲" : ""}</span>`;
}

// 毎日のリスト（買取額＋残り点数＋前日比を強調＋ラウンジ価格＋前週比）。rowsは値上がり→値下がり→変動なし→NEW順に並び済み前提。
function buildListHtml(rows, meta, weekMap) {
  const up = rows.filter((r) => r.diff > 0).length, down = rows.filter((r) => r.diff < 0).length, fresh = rows.filter((r) => r.diff == null).length;
  const head = `
    <div style="font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B">
      <h2 style="font-size:17px;margin:0 0 4px">トレカバンク 買取リスト</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6">
        ${meta.date}(${WD_LABEL}) 時点 ／ 対象 <b>${rows.length}件</b>（残り${MIN_REMAINING}点↑・買取10万円↑は30点↑・50万円↑は20点↑・${priceCapLabel}${EXCLUDE_BOX ? "未開封BOX除外" : "BOX含む"}）<br>
        <span style="color:#16a34a;font-weight:700">▲上昇 ${up}</span> ／ <span style="color:#ef4444;font-weight:700">▼下落 ${down}</span>${fresh ? ` ／ NEW ${fresh}` : ""} 件（前日比・<b>値上がり→値下がり→変動なし順</b>）<br>
        大きい金額=トレカバンク買取・ラ=トレカラウンジ郵送買取(枚数制限なしが多い)。<span style="color:#16a34a;font-weight:700">緑▲</span>=ラウンジの方が高い。<br>
        ※ グレード品(PSA10等)の買取額は鑑定済み前提。Mercariで仕入れる際はグレードを合わせること。
      </p>`;
  const body = rows.map(({ p, diff, tl }) => {
    const img = BASE + String(p.image_path || "").replace(/^\/+/, "");
    const sub = [p.product_master_key1, p.product_master_key2].filter(Boolean).join(" ");
    const k = keyOf(p);
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;width:56px"><img src="${esc(img)}" alt="" width="52" height="52" style="width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f3f4f6"></td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee">
          <div style="font-size:13px;font-weight:700;line-height:1.4">${esc(p.product_master_name)}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:3px">${sub ? esc(sub) + " " : ""}${mercariBtn(p.product_master_name)}${snkrdunkBtn(p.product_master_name)}</div>
        </td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
          <div style="font-size:14px;font-weight:800">${yen(p.buy_price)}</div>
          <div style="font-size:11px;margin-top:2px">前日比 ${diff == null ? `<span style="color:#0d9488;font-weight:700">NEW</span>` : deltaSpan(Number(p.buy_price), Number(p.buy_price) - diff)}</div>
          <div style="font-size:11px;color:#ef4444;font-weight:700">残${esc(p.remaining_quantity)}点</div>
          <div style="font-size:11px">ラ ${loungeCell(tl, p.buy_price)}</div>
          <div style="font-size:10px;color:#9ca3af">前週 ${deltaSpan(p.buy_price, weekMap ? weekMap[k] : null)}</div>
        </td>
      </tr>`;
  }).join("");
  return `${head}<table style="width:100%;border-collapse:collapse">${body}</table>
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">出典: <a href="${SOURCE_URL}" style="color:#6b7280">store.torecabank.com/kaitori_list</a>（自動取得）</p></div>`;
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

  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const all = extractProducts(await res.text());
  const todayMap = {}; for (const p of all) todayMap[keyOf(p)] = Number(p.buy_price); // スナップショット用（key→価格）
  const date = jstNow().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

  // 前日/前週の価格スナップショットを読む（前日比/前週比の基準）＋トレカラウンジ価格。
  let prevMap = null, weekMap = null;
  if (KV_ON) {
    try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-1))]); prevMap = v ? JSON.parse(v) : null; } catch { /* noop */ }
    try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-7))]); weekMap = v ? JSON.parse(v) : null; } catch { /* noop */ }
  }
  const tlMap = await fetchLoungeMap();

  // 対象抽出＋前日比を付与し、値上がり→値下がり→変動なし→NEW順に（各グループ内は変動幅/金額の大きい順）。
  const grp = (r) => (r.diff == null ? 3 : r.diff > 0 ? 0 : r.diff < 0 ? 1 : 2);
  const rows = all
    .filter((p) => Number(p.remaining_quantity) >= minRemainFor(Number(p.buy_price)) && (MAX_PRICE <= 0 || Number(p.buy_price) <= MAX_PRICE) && !(EXCLUDE_BOX && /BOX/i.test(p.product_type_name)))
    .map((p) => {
      const base = prevMap ? prevMap[keyOf(p)] : null;
      return { p, diff: base == null ? null : Number(p.buy_price) - Number(base), tl: loungePriceFor(p, tlMap) };
    })
    .sort((a, b) => {
      if (grp(a) !== grp(b)) return grp(a) - grp(b);                    // グループ順(値上がり→値下がり→変動なし→NEW)
      if (grp(a) === 0) return b.diff - a.diff;                          // 値上がり: 上昇の大きい順
      if (grp(a) === 1) return a.diff - b.diff;                          // 値下がり: 下落の大きい順
      return Number(b.p.buy_price) - Number(a.p.buy_price);              // 変動なし/NEW: 金額の高い順
    });
  const up = rows.filter((r) => r.diff > 0).length, down = rows.filter((r) => r.diff < 0).length;
  console.log(`[torecabank] 毎日リスト: 残り${MIN_REMAINING}点↑(10万↑=30点/50万↑=20点)・${priceCapLabel || "上限なし・"}${EXCLUDE_BOX ? "BOX除外" : ""} → ${rows.length}件（▲${up} ▼${down}）`);

  const html2 = buildListHtml(rows, { date }, weekMap);
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
