// 【アドホック分析】ブルーロケット vs トレカラウンジ別館買取センター 買取価格比較レポート。
// ユーザー依頼2026-08-26。定期実行はしない(adhoc-report.yml の workflow_dispatch からのみ)。
// 実行: node scripts/brVsAnnexReport.mjs [--dry]
import fs from "node:fs";


const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const DRY = process.argv.includes("--dry");

const normModel = (s) => String(s || "").normalize("NFKC").split(/[(（]/)[0].replace(/\s+/g, "").toUpperCase();
const cardName = (s) => String(s || "").replace(/^[(（][^)）]*[)）]/, "").split(/[\[［(（:：]/)[0].trim();
const squash = (s) => String(s || "").normalize("NFKC").replace(/[\s・･]/g, "").toLowerCase();
const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ── データ取得 ──
async function fetchStock() {
  const r = await fetch(`${process.env.SEDORI_SUPABASE_URL}/rest/v1/rpc/stock_for_report`, {
    method: "POST",
    headers: { apikey: process.env.SEDORI_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.SEDORI_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: process.env.SEDORI_REPORT_TOKEN }),
  });
  if (!r.ok) throw new Error("stock " + r.status);
  return r.json();
}

async function fetchBR() {
  const map = new Map();
  let total = 0;
  for (let page = 1; page <= 30; page++) {
    const r = await fetch(`https://bluerocket-tcg.com/products?page=${page}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) break;
    const html = await r.text();
    const items = [...html.matchAll(/data-product-name="([^"]+)"[\s\S]{0,200}?data-product-price="(\d+)"[\s\S]{0,160}?data-product-category="([^"]*)"/g)];
    if (!items.length) break;
    for (const [, rawName, priceRaw, category] of items) {
      if (category !== "PSA") continue;
      const tokens = rawName.trim().split(/\s+/);
      const kind = (tokens[0] || "").toUpperCase();
      const model = tokens[tokens.length - 1] || "";
      if (!/^PSA\d+$/.test(kind) || !model.includes("/")) continue;
      const name = tokens.slice(1, -1).join(" ");
      const k = normModel(model);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ name, price: Number(priceRaw), kind, model });
      total++;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  console.log("[br]", total, "件");
  return map;
}

const nameHit = (a, b) => {
  const x = squash(a), y = squash(b);
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
};
const brFor = (brMap, model, name, kind = "PSA10") => {
  const c = (brMap.get(normModel(model)) || []).filter((r) => r.kind === kind && nameHit(name, r.name));
  return c.length ? Math.min(...c.map((r) => r.price)) : null;
};

// 別館買取センターの公開シート(ポケモンタブ・全PSA10)
function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
async function fetchAnnex() {
  const url = "https://docs.google.com/spreadsheets/d/1nZXgbFCh-70YxmMJSs-fBDkbn_sy8IvBAQ-gIPmW2GQ/export?format=csv&gid=1341670214";
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("annex " + r.status);
  const lines = (await r.text()).split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const [, priceRaw, name, model, kind] = parseCsvLine(line);
    const price = Number(String(priceRaw || "").replace(/[^0-9]/g, ""));
    if (!model || !name || !(price > 0)) continue;
    rows.push({ name: String(name).trim(), model: String(model).trim(), price, kind: String(kind || "").trim() });
  }
  console.log("[annex]", rows.length, "件");
  return rows;
}

const [stock, annexRows, brMap] = await Promise.all([fetchStock(), fetchAnnex(), fetchBR()]);
console.log("[stock]", stock.length);
const annexByModel = new Map();
for (const a of annexRows) {
  const k = normModel(a.model);
  if (!annexByModel.has(k)) annexByModel.set(k, []);
  annexByModel.get(k).push(a);
}
const annexFor = (model, name) => {
  const c = (annexByModel.get(normModel(model)) || []).filter((r) => r.kind === "PSA10" && nameHit(name, r.name));
  return c.length ? Math.min(...c.map((r) => r.price)) : null;
};

// ── Part1: 在庫での比較 ──
const inv = stock.map((it) => {
  const tb = annexFor(it.model_number, it.name); // 変数名tbのまま「別館」を入れる(以降のロジック共用)
  const br = brFor(brMap, it.model_number, it.name);
  return { it, tb, br };
});
const both = inv.filter((r) => r.tb != null && r.br != null);
const tbOnly = inv.filter((r) => r.tb != null && r.br == null);
const brOnly = inv.filter((r) => r.tb == null && r.br != null);
const none = inv.filter((r) => r.tb == null && r.br == null);
const brWin = both.filter((r) => r.br > r.tb);
const tbWin = both.filter((r) => r.tb > r.br);
const tie = both.filter((r) => r.tb === r.br);
const sumTB = both.reduce((s, r) => s + r.tb, 0);
const sumBR = both.reduce((s, r) => s + r.br, 0);

// ── Part2: カタログ全体(ポケモンPSA10)の突合 ──
const pairs = [];
for (const a of annexRows) {
  if (a.kind !== "PSA10") continue;
  const br = brFor(brMap, a.model, a.name);
  if (br != null) pairs.push({ name: a.name, model: a.model, tb: a.price, br, remain: "-" });
}
const cBrWin = pairs.filter((r) => r.br > r.tb);
const cTbWin = pairs.filter((r) => r.tb > r.br);
const cTie = pairs.filter((r) => r.tb === r.br);
const diffs = pairs.map((r) => (r.br - r.tb) / r.tb).sort((a, b) => a - b);
const median = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
const topBR = [...pairs].sort((a, b) => (b.br - b.tb) - (a.br - a.tb)).slice(0, 15);

// ── HTML ──
const invRows = both
  .sort((a, b) => squash(a.it.name).localeCompare(squash(b.it.name), "ja"))
  .map((r) => {
    const w = r.br > r.tb ? "br" : r.tb > r.br ? "tb" : "tie";
    return `<tr><td class="nm2">${esc(r.it.name)}<div class="sb2">${esc(r.it.model_number || "")} ／ 仕入 ${yen(r.it.cost_price)}</div></td>` +
      `<td class="num${w === "tb" ? " win" : ""}">${yen(r.tb)}</td>` +
      `<td class="num${w === "br" ? " win" : ""}">${yen(r.br)}</td>` +
      `<td class="num ${r.br - r.tb > 0 ? "up" : r.br - r.tb < 0 ? "dn" : "eq"}">${r.br - r.tb > 0 ? "+" : ""}${(r.br - r.tb).toLocaleString("ja-JP")}</td></tr>`;
  }).join("");
const topRows = topBR.map((r) =>
  `<tr><td class="nm2">${esc(r.name)}<div class="sb2">${esc(r.model)} ／ 別館掲載</div></td>` +
  `<td class="num">${yen(r.tb)}</td><td class="num win">${yen(r.br)}</td>` +
  `<td class="num up">+${(r.br - r.tb).toLocaleString("ja-JP")}</td></tr>`).join("");

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const date = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
.wrap{font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B}
.hd{font-size:15px;font-weight:800;margin:0 0 2px}.sub{font-size:12px;color:#6b7280;margin:0 0 12px}
.sum{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:0 0 8px;font-size:12px;line-height:1.8}
.sum b{font-size:14px}
h3{font-size:13px;font-weight:800;margin:18px 0 4px}
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:10px;color:#9ca3af;text-align:right;padding:2px 6px;border-bottom:1px solid #e5e7eb}
.tbl th:first-child{text-align:left}
.tbl td{padding:4px 6px;border-bottom:1px solid #f1f2f4;vertical-align:top}
.nm2{font-size:12px;font-weight:700}
.sb2{font-size:10px;color:#9ca3af;font-weight:400}
.num{text-align:right;white-space:nowrap;font-size:12px}
.win{font-weight:800;color:#16a34a}
.up{color:#16a34a;font-weight:700}.dn{color:#ef4444}.eq{color:#9ca3af}
.note{font-size:11px;color:#9ca3af;margin:14px 0 0;line-height:1.7}
</style></head><body><div class="wrap">
<p class="hd">ブルーロケット vs 別館買取センター 買取比較</p>
<p class="sub">${esc(date)} 時点のPSA10買取表を突合(照合=型番+カード名+グレード)</p>

<div class="sum">
<b>あなたの在庫(${stock.length}件)</b><br>
両店に価格あり: <b>${both.length}件</b> ─ 別館が高い ${tbWin.length}件 ／ ブルロケが高い ${brWin.length}件 ／ 同額 ${tie.length}件<br>
両店掲載分を全部売った場合: 別館 <b>${yen(sumTB)}</b> vs ブルロケ <b>${yen(sumBR)}</b>(差 ${sumBR - sumTB >= 0 ? "+" : ""}${(sumBR - sumTB).toLocaleString("ja-JP")}円)<br>
別館のみ掲載 ${tbOnly.length}件 ／ ブルロケのみ掲載 ${brOnly.length}件 ／ どちらにも無い ${none.length}件
</div>
<div class="sum">
<b>カタログ突合(ポケモンPSA10・両店掲載 ${pairs.length}件)</b><br>
別館が高い <b>${cTbWin.length}件(${pct(cTbWin.length, pairs.length)}%)</b> ／ ブルロケが高い <b>${cBrWin.length}件(${pct(cBrWin.length, pairs.length)}%)</b> ／ 同額 ${cTie.length}件<br>
価格差の中央値: ブルロケは別館比 <b>${(median * 100).toFixed(1)}%</b>
</div>

<h3>① あなたの在庫の店別価格(両店掲載分)</h3>
<table class="tbl"><tr><th>カード</th><th>別館(ラ店頭)</th><th>ブルロケ</th><th>差(BR−TB)</th></tr>${invRows}</table>

<h3>② ブルロケ優位トップ15(両店カタログ突合)</h3>
<p class="sub" style="margin:0 0 4px">＝別館よりブルロケの方が高い順</p>
<table class="tbl"><tr><th>カード</th><th>別館(ラ店頭)</th><th>ブルロケ</th><th>差</th></tr>${topRows}</table>

<p class="note">別館=トレカラウンジ別館買取センター(秋葉原・店頭)の公開シート。ブルロケ=bluerocket-tcg.com(秋葉原・店頭/郵送)。<br>
どちらも秋葉原で持ち込み可能な2店の比較。突合はこの瞬間の両表に基づくスナップショットです。</p>
</div></body></html>`;

const subject = `【比較】別館(ラ店頭) vs ブルロケ ─ 在庫${both.length}件は 別館${tbWin.length}勝/BR${brWin.length}勝・全体はBR優位${pct(cBrWin.length, pairs.length)}%`;
console.log("件名:", subject);
console.log(`在庫: 両店${both.length} 別館勝${tbWin.length} BR勝${brWin.length} 同額${tie.length} / TBのみ${tbOnly.length} BRのみ${brOnly.length} なし${none.length}`);
console.log(`カタログ: 突合${pairs.length} 別館勝${cTbWin.length} BR勝${cBrWin.length} 同額${cTie.length} 中央値${(median * 100).toFixed(1)}%`);

if (DRY) {
  fs.writeFileSync("br_vs_annex_preview.html", html);
  console.log("[dry] br_vs_annex_preview.html");
} else {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "せどり帳 含み益ウォッチ <noreply@yushutsu-fukugyo.com>", to: "chikara0323@gmail.com", subject, html }),
  });
  if (!r.ok) throw new Error("send " + r.status + " " + (await r.text()).slice(0, 200));
  console.log("送信完了");
}
