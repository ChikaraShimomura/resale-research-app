// iOSアプリ「せどり帳」の共有帳簿にある【在庫】と、トレカバンクの【買取表】を突き合わせて、
// 「今トレカバンクに送ればプラスになる在庫」だけを毎朝9:30 JSTにメールする（ユーザー指示2026-08-10）。
//
// 在庫の取り方: せどり帳のSupabaseは【App Store配信中のせどり帳ユーザー全員の共有帳簿が入る本番DB】なので、
//   RLSを全部貫通する service_role キーは使わない。代わりに「指定した1帳簿の在庫行だけを返す」
//   security definer 関数 public.stock_for_report(token) を用意し、cronにはその呼び出しトークンだけを渡す。
//   (定義は sedori-ledger/supabase/patch-report-token.sql)。トークンが漏れても被害はこの帳簿の在庫の読み取りだけ。
//
// 照合: 【型番(model_number) × カード名 × グレード】の3点一致だけを「確定」とする。
//   トレカバンクの買取表は実測で PSA10 と 未開封BOX しか無いため、無鑑定カードを混ぜると
//   桁違いの過大評価＝嘘の通知になる。★在庫は全てPSA10鑑定済みという前提(ユーザー確認2026-08-10)で動く。
//   無鑑定を仕入れ始めたら SEDORI_DEFAULT_GRADE=none にして、PSA10の行だけ名前かメモに「PSA10」と書く運用に切り替えること。
//
// env:
//   SEDORI_SUPABASE_URL / SEDORI_SUPABASE_ANON_KEY / SEDORI_REPORT_TOKEN   在庫の取得元(トークン未設定なら何もせず正常終了)
//   RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可) / MAIL_BCC
//   MIN_PROFIT            これ未満の含み益は載せない（円・既定1＝プラスなら全部）
//   REQUIRE_AVAILABLE     "0"で「残り点数0以下(買取受付終了)」も載せる（既定は除外）
//   MIN_HOLD_DAYS         仕入れ登録から何日経った在庫を対象にするか（既定2＝今日と昨日の登録は除外）
//   SEND_WHEN_EMPTY       "0"で0件の日は送らない（既定は送る＝届かない日は故障と分かる）
//   SEDORI_DEFAULT_GRADE  グレード表記が無い在庫行の既定グレード（既定 PSA10 / "none"で照合対象外にする）
//   KV_REST_API_URL / KV_REST_API_TOKEN   本日送信済みガード
//   FORCE_SEND            "1"でガードを無視して必ず送る（手動再送）
//
// 使い方: node --env-file=.env.local scripts/sedoriTorecabankProfitMail.mjs [--dry]

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { extractProducts } from "./torecabankKaitoriMail.mjs";

const SOURCE_URL = "https://store.torecabank.com/kaitori_list";
const BASE = "https://store.torecabank.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const SB_URL = process.env.SEDORI_SUPABASE_URL || "";
const SB_ANON = process.env.SEDORI_SUPABASE_ANON_KEY || "";
const SB_TOKEN = process.env.SEDORI_REPORT_TOKEN || "";

const MIN_PROFIT = Number(process.env.MIN_PROFIT ?? 1);
const REQUIRE_AVAILABLE = process.env.REQUIRE_AVAILABLE !== "0";
// 仕入れ登録から何日経った在庫を対象にするか（ユーザー指示2026-08-10「直近2日間で仕入れ登録された
// ものは除いて、3日前から登録されたものだけ」）。2＝今日と昨日に登録した分を外し、一昨日以前を載せる。
const MIN_HOLD_DAYS = Number(process.env.MIN_HOLD_DAYS ?? 2);
const SEND_WHEN_EMPTY = process.env.SEND_WHEN_EMPTY !== "0";
const DEFAULT_GRADE = process.env.SEDORI_DEFAULT_GRADE || "PSA10";

const MAIL_FROM = process.env.MAIL_FROM || "せどり帳 含み益ウォッチ <noreply@yushutsu-fukugyo.com>";
const parseAddrs = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const MAIL_TO = process.env.MAIL_TO || "chikara0323@gmail.com";
const MAIL_BCC = process.env.MAIL_BCC || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;
const FORCE = process.argv.includes("--force") || process.env.FORCE_SEND === "1";

const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_ON = Boolean(KV_URL && KV_TOKEN);
// 既存のトレカバンク買取メール(tb_sent:*)とはキー空間を分ける＝お互いのガードを壊さない。
const SENT_KEY = (day) => `sedori_tb_sent:${day}`;
const SENT_TTL = 2 * 24 * 60 * 60;

const jstNow = () => new Date(Date.now() + 9 * 3600e3);
const jstDay = () => jstNow().toISOString().slice(0, 10);
const WD_LABEL = ["日", "月", "火", "水", "木", "金", "土"][jstNow().getUTCDay()];

const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── 照合の正規化 ───────────────────────────────────────────────
// 型番: NFKC→飾り括弧を落とす→空白除去→大文字。「213/172」「218/SV-P」等が素直に一致する。
const normModel = (s) => String(s || "").normalize("NFKC").split(/[(（]/)[0].replace(/\s+/g, "").toUpperCase();
// TB商品名からカード基本名: 先頭の「(PSA10)」を剥ぎ、[セット記号]/(補足)/:1ED 以降を落とす。
// 「(PSA10)リーリエ[SM4+]」→「リーリエ」 /「(PSA10)ピカチュウ(ムンク展)」→「ピカチュウ」
const cardName = (s) => String(s || "").replace(/^[(（][^)）]*[)）]/, "").split(/[\[［(（:：]/)[0].trim();
// 比較用に潰す: NFKC(全角英数/＆→&)＋空白/中黒を除去＋小文字化。
const squash = (s) => String(s || "").normalize("NFKC").replace(/[\s・･]/g, "").toLowerCase();
// 商品名の「フルネーム」: 先頭の(グレード)を剥ぐ→[セット記号]を消す→括弧記号だけ落として潰す。
// 「(PSA10)ミュウツー(マスターボールミラー)[SV2a]」→「ミュウツーマスターボールミラー」。
// 在庫名にも同じ変換をかけて突き合わせる＝型番の打ち間違いを名前だけで拾うための保険。
const fullName = (s) => squash(String(s || "").replace(/^[(（][^)）]*[)）]/, "").replace(/[\[［][^\]］]*[\]］]/g, "").replace(/[()（）]/g, ""));

// 仕入れ日(purchase_date="YYYY-MM-DD")から今日(JST)までの経過日数。
// 日付だけで引き算する＝時刻やタイムゾーンでブレない。日付が無い行は古い扱い(除外しない)。
function daysSincePurchase(purchaseDate) {
  if (!purchaseDate) return Infinity;
  const [y, m, d] = String(purchaseDate).split("-").map(Number);
  if (!y || !m || !d) return Infinity;
  const today = jstNow();
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((t - Date.UTC(y, m - 1, d)) / 86400000);
}

// せどり帳の行のグレード。名前/メモにBOX系があれば未開封BOX、PSA10表記があればPSA10、
// 何も書いていなければ既定(=PSA10。在庫は全て鑑定済みというユーザー確認に基づく)。
function gradeOf(item) {
  const s = `${item.name || ""} ${item.memo || ""} ${item.category || ""}`;
  if (/(未開封|シュリンク|\bbox\b)/i.test(s)) return "BOX";
  if (/psa\s*10/i.test(s)) return "PSA10";
  return DEFAULT_GRADE === "none" ? null : DEFAULT_GRADE;
}
// TB側のグレード表記は "PSA10" / "未開封BOX（テープ付き）" / "未開封BOX（シュリンク付き）" の3種だけ(実測)。
const gradeMatches = (g, tbType) => (g === "BOX" ? /未開封BOX/.test(tbType) : tbType === g);

// 相場の照合先。カード名+型番+グレードで引くと個体がほぼ一意に当たる(既存メーラーと同じ作法)。
const mercariUrl = (name, model) =>
  `https://jp.mercari.com/search?keyword=${encodeURIComponent(`${name} ${model} PSA10`.trim())}&status=on_sale&sort=price&order=asc`;

async function kvCmd(cmd) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`KV ${cmd[0]} ${r.status}`);
  return (await r.json()).result;
}

/** せどり帳の在庫行。RLSを越えるのは stock_for_report が書いた1本のSELECTだけ＝他人の帳簿は返らない。 */
async function fetchStock() {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/stock_for_report`, {
    method: "POST",
    headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: SB_TOKEN }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`せどり帳の在庫取得に失敗: ${r.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

/**
 * 在庫1件をトレカバンク商品に突き合わせる。確定の条件は【型番＋グレード＋カード名】の3点一致。
 * 型番だけの一致で確定してはいけない（同一型番に別カードがぶら下がる型番が実測34件ある）。
 */
function matchOne(item, byModel, byFullName) {
  const grade = gradeOf(item);
  const model = normModel(item.model_number);
  // 型番で当たらなかった時の保険。名前(フルネーム)が【ちょうど1件】に一致した場合だけ「型番が違うかも」として拾う。
  // 断定はしない＝どちらの型番が正しいか決められないので、含み益の本リストには入れず別枠で知らせる。
  const suspect = () => {
    if (!grade) return null;
    const c = (byFullName.get(fullName(item.name)) || []).filter((p) => gradeMatches(grade, p.product_type_name));
    return c.length === 1 ? c[0] : null;
  };
  if (!grade || !model) return { item, grade, model, hit: null, suspect: suspect(), reason: !model ? "型番なし" : "グレード不明" };
  const sameModel = (byModel.get(model) || []).filter((p) => gradeMatches(grade, p.product_type_name));
  if (!sameModel.length) return { item, grade, model, hit: null, suspect: suspect(), reason: "買取表に無い" };
  const mine = squash(item.name);
  // カード名の一致検証: TB側の基本名が在庫名に含まれること。実データ39件で誤爆0・複数候補0を確認済み。
  const named = sameModel.filter((p) => {
    const base = squash(cardName(p.product_master_name));
    return base.length >= 2 && mine.includes(base);
  });
  if (!named.length) return { item, grade, model, hit: null, suspect: suspect(), reason: "カード名が一致しない", cands: sameModel };
  // 同名候補が複数あるときは安全側＝一番安い買取額を採用する(含み益を盛らない)。
  const hit = named.reduce((a, b) => (Number(a.buy_price) <= Number(b.buy_price) ? a : b));
  return { item, grade, model, hit };
}

function buildHtml(rows, skipped, unmatched, suspects, freshCount, date) {
  const total = rows.reduce((s, r) => s + r.profitTotal, 0);
  const css = `
    .wrap{font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B;-webkit-text-size-adjust:100%;text-size-adjust:100%}
    .hd{font-size:15px;font-weight:800;margin:0 0 2px}
    .sub{font-size:12px;color:#6b7280;margin:0 0 12px}
    .sum{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin:0 0 14px}
    .sumv{font-size:20px;font-weight:800;color:#16a34a}
    .suml{font-size:11px;color:#6b7280}
    .tbl{width:100%;border-collapse:collapse}
    .tbl td{padding:8px 6px;border-bottom:1px solid #eee;vertical-align:top}
    .ic{width:56px}
    .ic img{width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f3f4f6;vertical-align:top}
    .nm{font-size:13px;font-weight:700;line-height:1.4}
    .sb{font-size:11px;color:#9ca3af;margin-top:3px}
    .bt{margin-top:5px}
    .btn{display:inline-block;padding:1px 8px;border-radius:9px;color:#ffffff !important;font-size:11px;line-height:1.5;font-weight:700;text-decoration:none;white-space:nowrap}
    .pr{text-align:right;white-space:nowrap}
    .p1{font-size:15px;font-weight:800;color:#16a34a}
    .p2{font-size:11px;color:#6b7280;margin-top:2px}
    .rm{font-size:11px;color:#ef4444;font-weight:700;margin-top:2px}
    .gb{display:inline-block;margin-left:4px;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;color:#fff;background:#A98B5C}
    .ah{font-size:13px;font-weight:800;margin:18px 0 2px;color:#b45309}
    .as{font-size:11px;color:#6b7280;margin:0 0 6px;line-height:1.6}
    .note{font-size:11px;color:#9ca3af;margin:14px 0 0;line-height:1.6}
    .warn{font-size:12px;color:#6b7280;background:#f9fafb;border-radius:8px;padding:9px 11px;margin:14px 0 0;line-height:1.7}`;

  const body = rows.map((r) => {
    const { item, hit } = r;
    const img = hit.image_path ? BASE + hit.image_path : "";
    const q = item.quantity > 1 ? `<span class="sb">×${item.quantity}個</span>` : "";
    return `<tr><td class="ic"><img src="${esc(img)}" alt="" width="52" height="52"></td>` +
      `<td><div class="nm">${esc(item.name)}${q}<span class="gb">${esc(hit.product_type_name)}</span></div>` +
      `<div class="sb">${esc(item.model_number || "")} ／ 買取表: ${esc(hit.product_master_name)}</div>` +
      `<div class="bt"><a class="btn" href="${SOURCE_URL}" style="background:#0d9488">買取表🔍</a> ` +
      `<a class="btn" href="${mercariUrl(cardName(hit.product_master_name), item.model_number || "")}" style="background:#FA5252">メルカリ🔍</a></div></td>` +
      `<td class="pr"><div class="p1">＋${yen(r.profitTotal)}</div>` +
      `<div class="p2">${yen(item.cost_price)} → ${yen(hit.buy_price)}</div>` +
      `<div class="p2">残り${esc(hit.remaining_quantity)}点</div></td></tr>`;
  }).join("");

  const skipNote = skipped.length
    ? `<div class="warn">🕒 買取の<b>受付が終了</b>していて今日は送れない在庫が <b>${skipped.length}件</b> あります（含み益の合計 ${yen(skipped.reduce((s, r) => s + r.profitTotal, 0))}）。枠が戻れば翌朝のメールに出ます。</div>`
    : "";
  const freshNote = freshCount
    ? `<div class="warn">🆕 仕入れ登録から<b>${MIN_HOLD_DAYS}日未満</b>の在庫 <b>${freshCount}件</b> は対象外にしています。${MIN_HOLD_DAYS}日経てば自動でリストに入ります。</div>`
    : "";
  // 名前は完全一致したのに型番が食い違う行＝どちらかの打ち間違い。含み益は「参考」として出し、本リストには入れない。
  const suspectNote = suspects.length
    ? `<div class="warn">🔧 <b>型番が違うかもしれない在庫 ${suspects.length}件</b>（カード名は買取表と完全一致・アプリの型番を直すと本リストに載ります）:<br>` +
      suspects.map((u) => {
        const d = Number(u.suspect.buy_price) - Number(u.item.cost_price);
        return `・${esc(u.item.name)}<br>&nbsp;&nbsp;登録型番 <b>${esc(u.item.model_number || "なし")}</b> → 買取表 <b>${esc(u.suspect.product_master_key2)}</b>` +
          `（${esc(u.suspect.product_master_name)}）<br>&nbsp;&nbsp;${yen(u.item.cost_price)} → 買取${yen(u.suspect.buy_price)} ＝ ` +
          `<b style="color:${d > 0 ? "#16a34a" : "#ef4444"}">${d > 0 ? "＋" : "－"}${yen(Math.abs(d))}</b>（参考・残り${esc(u.suspect.remaining_quantity)}点）`;
      }).join("<br>") +
      `</div>`
    : "";
  // 仕入れ元がトレカバンクの買取表なので「載っていない」は異常＝型番の打ち間違いか、買取枠が埋まって
  // 落ちたかのどちらか(ユーザー指示2026-08-10)。埋もれないよう独立したセクションで出す。
  const unmatchedNote = unmatched.length
    ? `<h3 class="ah">⚠️ 買取表に見つからない在庫 ${unmatched.length}件</h3>
       <p class="as">仕入れ元の買取表に今日は載っていません。<b>型番の打ち間違い</b>か、<b>買取枠が埋まって掲載が終了</b>したかのどちらかです。</p>
       <table class="tbl">` +
      unmatched.map((u) => `<tr><td><div class="nm">${esc(u.item.name)}</div>` +
        `<div class="sb">型番 ${esc(u.item.model_number || "未入力")} ／ ${esc(u.reason)} ／ ${esc(u.item.purchase_date || "")}仕入れ</div>` +
        `<div class="bt"><a class="btn" href="${SOURCE_URL}" style="background:#0d9488">買取表🔍</a> ` +
        `<a class="btn" href="${mercariUrl(u.item.name, u.item.model_number || "")}" style="background:#FA5252">メルカリ🔍</a></div></td>` +
        `<td class="pr"><div class="p2">仕入 ${yen(u.item.cost_price)}</div></td></tr>`).join("") +
      `</table>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="wrap">
    <p class="hd">今トレカバンクに送ればプラスになる在庫</p>
    <p class="sub">${esc(date)}（${WD_LABEL}）／ せどり帳の在庫と本日の買取表を照合</p>
    <div class="sum"><div class="sumv">${rows.length}件・合計 ＋${yen(total)}</div><div class="suml">含み益＝買取額 − 仕入れ値（送料・梱包費は含みません）</div></div>
    <table class="tbl">${body}</table>
    ${skipNote}${freshNote}${suspectNote}${unmatchedNote}
    <p class="note">照合は<b>型番＋カード名＋グレード</b>の3点一致のみを採用しています。在庫は<b>すべてPSA10鑑定済み</b>という前提で計算しているので、無鑑定のカードを登録した場合はその行の金額が実態と合わなくなります。<br>
    出典: <a href="${SOURCE_URL}" style="color:#6b7280">store.torecabank.com/kaitori_list</a>（自動取得）</p>
  </div></body></html>`;
}

async function sendMail(subject, html) {
  const toList = parseAddrs(MAIL_TO), bccList = parseAddrs(MAIL_BCC);
  const payload = { from: MAIL_FROM, to: toList, subject, html };
  if (bccList.length) payload.bcc = bccList;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Resend send failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  console.log(`[sedori] 送信完了 → to:${toList.join(",")}${bccList.length ? " / bcc:" + bccList.join(",") : ""}`);
  if (KV_ON) {
    try { await kvCmd(["SET", SENT_KEY(jstDay()), "1", "EX", String(SENT_TTL)]); }
    catch (e) { console.warn("[guard] 送信済み記録に失敗:", e.message); }
  }
}

export async function main() {
  // トークン未設定なら何もしない(鍵を入れる前にActionsを赤くしないため)。設定漏れは気付けるようログには必ず出す。
  if (!SB_URL || !SB_ANON || !SB_TOKEN) {
    console.warn("[sedori] SEDORI_SUPABASE_URL / SEDORI_SUPABASE_ANON_KEY / SEDORI_REPORT_TOKEN が未設定＝何もせず終了");
    return;
  }
  // 本日送信済みガード（予備cronや再実行での二重送信を防ぐ）。
  if (!DRY && !FORCE && KV_ON) {
    try {
      if (await kvCmd(["GET", SENT_KEY(jstDay())])) { console.log("[sedori] 本日分は送信済み＝スキップ"); return; }
    } catch (e) { console.warn("[guard] 送信済み確認に失敗（続行）:", e.message); }
  }

  const [stock, res] = await Promise.all([
    fetchStock(),
    fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: AbortSignal.timeout(20000) }),
  ]);
  if (!res.ok) throw new Error(`買取表の取得に失敗: ${res.status}`);
  const products = extractProducts(await res.text());

  const byModel = new Map(), byFullName = new Map();
  for (const p of products) {
    const k = normModel(p.product_master_key2);
    if (k) {
      if (!byModel.has(k)) byModel.set(k, []);
      byModel.get(k).push(p);
    }
    const f = fullName(p.product_master_name);
    if (f.length >= 4) {
      if (!byFullName.has(f)) byFullName.set(f, []);
      byFullName.get(f).push(p);
    }
  }

  // 照合は【全在庫】に対して行う。仕入れ元がトレカバンクの買取表なので「買取表に無い」は異常＝
  // 型番の打ち間違いか買取表から落ちたかのどちらか(ユーザー指示2026-08-10)。登録直後こそ直しやすいので
  // 新しい行も警告の対象にする。日数のフィルタは含み益リスト側にだけ効かせる。
  const matched = [], unmatched = [], suspects = [];
  for (const item of stock) {
    const m = matchOne(item, byModel, byFullName);
    if (!m.hit) { (m.suspect ? suspects : unmatched).push(m); continue; }
    const qty = Number(item.quantity) || 1;
    const profitUnit = Number(m.hit.buy_price) - Number(item.cost_price);
    matched.push({ ...m, qty, profitUnit, profitTotal: profitUnit * qty, remain: Number(m.hit.remaining_quantity) });
  }

  // 含み益リストだけ「仕入れ登録から MIN_HOLD_DAYS 日以上」に絞る(ユーザー指示2026-08-10)。
  const plusAll = matched.filter((r) => r.profitUnit >= MIN_PROFIT);
  const plus = plusAll.filter((r) => daysSincePurchase(r.item.purchase_date) >= MIN_HOLD_DAYS);
  const freshCount = plusAll.length - plus.length;
  // 残り点数0以下=買取の受付枠が埋まっている＝今日送っても買い取ってもらえない(ユーザー指示2026-08-10で除外)。
  const rows = plus.filter((r) => !REQUIRE_AVAILABLE || r.remain > 0).sort((a, b) => b.profitTotal - a.profitTotal);
  const skipped = plus.filter((r) => REQUIRE_AVAILABLE && r.remain <= 0).sort((a, b) => b.profitTotal - a.profitTotal);

  const total = rows.reduce((s, r) => s + r.profitTotal, 0);
  const date = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  console.log(`[sedori] 在庫${stock.length}件 / 照合${matched.length}件 → 掲載${rows.length}件 合計＋${yen(total)}（直近${MIN_HOLD_DAYS}日の登録で見送り${freshCount}件・受付終了${skipped.length}件・型番違いの疑い${suspects.length}件・買取表に無い${unmatched.length}件）`);

  if (!rows.length && !SEND_WHEN_EMPTY) { console.log("[sedori] 0件＝送信しない設定のため終了"); return; }

  // 要確認(型番違いの疑い＋買取表に無い)は件名にも出す＝開かなくても異常に気付ける。
  const alerts = suspects.length + unmatched.length;
  const alertTail = alerts ? ` ／要確認${alerts}件` : "";
  const subject = rows.length
    ? `【せどり帳】今売ればプラス ${rows.length}件 ＋${yen(total)}${alertTail}（${date}）`
    : `【せどり帳】今日はプラスの在庫なし${alertTail}（${date}）`;
  const html = buildHtml(rows, skipped, unmatched, suspects, freshCount, date);

  if (DRY) {
    fs.writeFileSync("sedori_torecabank_preview.html", html);
    console.log(`[dry] プレビュー出力 sedori_torecabank_preview.html (${Math.round(Buffer.byteLength(html, "utf8") / 1024)}KB) / 件名: ${subject}`);
    rows.slice(0, 8).forEach((r) => console.log(`  ＋${yen(r.profitTotal)}  ${yen(r.item.cost_price)}→${yen(r.hit.buy_price)} 残${r.remain}点  ${r.item.name}`));
    return;
  }
  await sendMail(subject, html);
}

// CLIとして直接実行された時だけ動かす（importしただけでは送信しない）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("[sedori] 失敗:", e.message); process.exit(1); });
}
