// トレカバンクの「本日の買取表」から抽出して個人用メールする。曜日で2モード（ユーザー指示2026-07-09）:
//   ・月曜: 残り MIN_REMAINING(既定50)件以上・買取 MAX_PRICE(既定5万)以下・BOX除外 のリストを送信し、その集合を「月曜リスト」としてKVに保存。
//   ・火〜日: 月曜リストの各商品の【現在の買取額】を月曜比つきで送る（＝週の値動き追跡）。月曜リスト未作成なら送らない。
// 依存ゼロ（Node18+ の fetch のみ）。データはページHTMLの `const allProducts = [...]` 埋め込みを取るだけ＝APIキー/ブラウザ不要。
//
// 価格履歴: 毎回 全商品の買取額を KV `tb_price_snap:YYYY-MM-DD`(JST)に1日1キー保存。月曜リストの前日/前週比にも使う。
// 送信は Resend。RESEND_API_KEY 未設定 or `--dry` ならプレビューのみ（非破壊）。cron2本の二重送信は tb_sent:{date} で防ぐ。
//
// env:
//   RESEND_API_KEY / MAIL_FROM / MAIL_TO(カンマ区切り可) / MAIL_BCC(Bcc・カンマ区切り可)
//   MIN_REMAINING   月曜リストの残り点数の下限（既定: 50）
//   MAX_PRICE       買取額の上限・円（0=上限なし。既定0＝ユーザー指示2026-07-09で5万上限を解除）
//   EXCLUDE_BOX     "0"で未開封BOXも含める（既定はBOX除外）
//   KV_REST_API_URL / KV_REST_API_TOKEN   価格履歴＋月曜リスト保存＋送信済みガード
//   FORCE_SEND      "1"で本日送信済みガードを無視して必ず送る（手動再送）
//   FORCE_MODE      "monday"|"update" 曜日判定を上書き（テスト用）
//
// 使い方: node scripts/torecabankKaitoriMail.mjs [--dry] [--force]

import fs from "node:fs";

const SOURCE_URL = "https://store.torecabank.com/kaitori_list";
const BASE = "https://store.torecabank.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MIN_REMAINING = Number(process.env.MIN_REMAINING || 50); // 月曜リストの残り点数下限（ユーザー指示: 50件以上）
const MAX_PRICE = Number(process.env.MAX_PRICE) || 0; // 買取額の上限（円）。0=上限なし（ユーザー指示2026-07-09: 5万上限を解除）
const EXCLUDE_BOX = process.env.EXCLUDE_BOX !== "0"; // 既定=未開封BOX除外
const MAIL_FROM = process.env.MAIL_FROM || "トレカバンク買取ウォッチ <noreply@yushutsu-fukugyo.com>";
const parseAddrs = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const MAIL_TO = process.env.MAIL_TO || "chikara0323@gmail.com";
const MAIL_BCC = process.env.MAIL_BCC || "";
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
const MONDAY_KEY = "tb_monday_list"; // 月曜に送ったリスト（火〜日はこれの現在金額を送る）
const MONDAY_TTL = 8 * 24 * 60 * 60; // 次の月曜まで持てば十分

// JSTの曜日/日付。cronはUTCだが、この時点の実時刻をJSTに寄せて判定する（月曜08:05JST=日曜23:05UTC等でも正しく月曜と出る）。
const jstNow = () => new Date(Date.now() + 9 * 3600e3);
const jstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const JST_WD = jstNow().getUTCDay(); // 0=日,1=月,...,6=土
const WD_LABEL = ["日", "月", "火", "水", "木", "金", "土"][JST_WD];
const MODE = process.env.FORCE_MODE || (JST_WD === 1 ? "monday" : "update");

const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
const priceCapLabel = MAX_PRICE > 0 ? `買取${yen(MAX_PRICE)}以下・` : ""; // 上限ありの時だけ表示（0=無制限は表示しない）
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const keyOf = (p) => `${p.product_type_name}|${p.product_master_key1}|${p.product_master_key2}|${p.product_master_name}`;
const gradeBadge = (g) => `<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;color:#fff;background:${/BOX/i.test(g) ? "#0d9488" : "#A98B5C"}">${esc(g)}</span>`;

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

// 月曜モード：本日のリスト（買取額＋残り点数＋前日/前週比）。
function buildListHtml(rows, meta, prevMap, weekMap) {
  const head = `
    <div style="font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B">
      <h2 style="font-size:17px;margin:0 0 4px">トレカバンク 月曜リスト（残り${MIN_REMAINING}点以上）</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6">
        ${meta.date}(月) 時点 ／ 対象 <b>${rows.length}件</b>（残り${MIN_REMAINING}点以上・${priceCapLabel}${EXCLUDE_BOX ? "未開封BOX除外" : "BOX含む"}）<br>
        今週は火〜日にこのリストの現在金額を毎朝お送りします。<br>
        ※ グレード品(PSA10等)の買取額は鑑定済み前提。Mercariで仕入れる際はグレードを合わせること。
      </p>`;
  const body = rows.map((p) => {
    const img = BASE + String(p.image_path || "").replace(/^\/+/, "");
    const sub = [p.product_master_key1, p.product_master_key2].filter(Boolean).join(" ");
    const k = keyOf(p);
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;width:56px"><img src="${esc(img)}" alt="" width="52" height="52" style="width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f3f4f6"></td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee">
          <div style="font-size:13px;font-weight:700;line-height:1.4">${esc(p.product_master_name)}</div>
          <div style="font-size:11px;color:#9ca3af">${esc(sub)}${gradeBadge(p.product_type_name)}</div>
        </td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
          <div style="font-size:14px;font-weight:800">${yen(p.buy_price)}</div>
          <div style="font-size:11px;color:#ef4444;font-weight:700">残${esc(p.remaining_quantity)}点</div>
          <div style="font-size:10px;margin-top:3px;color:#9ca3af">前日 ${deltaSpan(p.buy_price, prevMap ? prevMap[k] : null)}</div>
          <div style="font-size:10px;color:#9ca3af">前週 ${deltaSpan(p.buy_price, weekMap ? weekMap[k] : null)}</div>
        </td>
      </tr>`;
  }).join("");
  return `${head}<table style="width:100%;border-collapse:collapse">${body}</table>
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">出典: <a href="${SOURCE_URL}" style="color:#6b7280">store.torecabank.com/kaitori_list</a>（自動取得）</p></div>`;
}

// 火〜日モード：月曜リストの各商品の「現在の買取額（月曜比）」。cohort=月曜保存分, byKey=本日の全商品(key→product)。
function buildUpdateHtml(cohort, byKey, meta) {
  const rows = cohort.items.map((it) => {
    const cur = byKey[it.key];
    const now = cur ? Number(cur.buy_price) : null;
    const nowRem = cur ? cur.remaining_quantity : null;
    return { ...it, now, nowRem, gone: !cur, diff: now == null ? null : now - it.price };
  }).sort((a, b) => (b.now ?? -1) - (a.now ?? -1));
  const up = rows.filter((r) => r.diff > 0).length, down = rows.filter((r) => r.diff < 0).length, gone = rows.filter((r) => r.gone).length;
  const head = `
    <div style="font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B">
      <h2 style="font-size:17px;margin:0 0 4px">月曜リストの現在金額（${WD_LABEL}曜）</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6">
        月曜(${esc(cohort.date)})のリスト <b>${cohort.items.length}件</b> ／ ${meta.date}(${WD_LABEL}) 時点<br>
        <span style="color:#16a34a;font-weight:700">▲上昇 ${up}</span> ／ <span style="color:#ef4444;font-weight:700">▼下落 ${down}</span> ／ 掲載終了 ${gone} 件（金額は月曜比）
      </p>`;
  const body = rows.map((r) => {
    const img = BASE + String(r.image_path || "").replace(/^\/+/, "");
    const rightNow = r.gone
      ? `<div style="font-size:12px;color:#9ca3af;font-weight:700">掲載終了</div>`
      : `<div style="font-size:14px;font-weight:800">${yen(r.now)}</div><div style="font-size:10px;margin-top:2px">月曜比 ${deltaSpan(r.now, r.price)}</div>${r.nowRem != null ? `<div style="font-size:10px;color:#ef4444">残${esc(r.nowRem)}点</div>` : ""}`;
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;width:56px"><img src="${esc(img)}" alt="" width="52" height="52" style="width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f3f4f6"></td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee">
          <div style="font-size:13px;font-weight:700;line-height:1.4">${esc(r.name)}</div>
          <div style="font-size:11px;color:#9ca3af">${esc(r.sub || "")}${gradeBadge(r.grade)}</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:2px">月曜 ${yen(r.price)}</div>
        </td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${rightNow}</td>
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

async function main() {
  // 本日送信済みガード（自動実行のみ。cron2本目/再実行の二重送信を防ぐ）。
  if (!DRY && !FORCE && KV_ON) {
    try { const already = await kvCmd(["GET", SENT_KEY(jstDay(0))]); if (already) { console.log(`[torecabank] 本日分は送信済み＝スキップ`); return; } } catch (e) { console.warn("[guard] 送信済み確認に失敗（続行）:", e.message); }
  }

  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const all = extractProducts(await res.text());
  const byKey = {}; for (const p of all) byKey[keyOf(p)] = p;
  const todayMap = {}; for (const p of all) todayMap[keyOf(p)] = Number(p.buy_price); // スナップショット用（key→価格）
  const date = jstNow().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

  // 価格スナップショット保存（毎日・1キー）。前日/前週比に使う。
  const saveSnapshot = async () => { if (KV_ON && !DRY) { try { await kvCmd(["SET", SNAP_KEY(jstDay(0)), JSON.stringify(todayMap), "EX", String(SNAP_TTL)]); console.log(`[kv] スナップショット保存 ${SNAP_KEY(jstDay(0))}（${Object.keys(todayMap).length}件）`); } catch (e) { console.warn("[kv] スナップショット保存失敗:", e.message); } } };

  let subject, html2;

  if (MODE === "monday") {
    // ── 月曜: リスト送信＋保存 ──
    let prevMap = null, weekMap = null;
    if (KV_ON) {
      try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-1))]); prevMap = v ? JSON.parse(v) : null; } catch { /* noop */ }
      try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-7))]); weekMap = v ? JSON.parse(v) : null; } catch { /* noop */ }
    }
    const rows = all
      .filter((p) => Number(p.remaining_quantity) >= MIN_REMAINING && (MAX_PRICE <= 0 || Number(p.buy_price) <= MAX_PRICE) && !(EXCLUDE_BOX && /BOX/i.test(p.product_type_name)))
      .sort((a, b) => Number(b.buy_price) - Number(a.buy_price));
    console.log(`[torecabank] 月曜モード: 残り${MIN_REMAINING}点以上・${priceCapLabel || "上限なし・"}${EXCLUDE_BOX ? "BOX除外" : ""} → ${rows.length}件`);
    html2 = buildListHtml(rows, { date }, prevMap, weekMap);
    subject = `【トレカバンク】月曜リスト ${rows.length}件（残り${MIN_REMAINING}点↑・${priceCapLabel}${date}）`;
    // 月曜リストを保存（火〜日が現在金額を突き合わせる）。
    if (KV_ON && !DRY) {
      const cohort = { date: jstDay(0), items: rows.map((p) => ({ key: keyOf(p), name: p.product_master_name, sub: [p.product_master_key1, p.product_master_key2].filter(Boolean).join(" "), image_path: p.image_path, grade: p.product_type_name, remaining: p.remaining_quantity, price: Number(p.buy_price) })) };
      try { await kvCmd(["SET", MONDAY_KEY, JSON.stringify(cohort), "EX", String(MONDAY_TTL)]); console.log(`[kv] 月曜リスト保存 ${MONDAY_KEY}（${cohort.items.length}件）`); } catch (e) { console.warn("[kv] 月曜リスト保存失敗:", e.message); }
    }
    await saveSnapshot();
    if (DRY) { fs.writeFileSync("torecabank_preview.html", html2); console.log(`[dry] 月曜プレビュー出力 / 件名: ${subject}`); rows.slice(0, 5).forEach((p) => console.log(`  ${yen(p.buy_price)} 残${p.remaining_quantity}点 ${p.product_master_name}`)); return; }
    await sendMail(subject, html2);
    return;
  }

  // ── 火〜日: 月曜リストの現在金額 ──
  let cohort = null;
  if (KV_ON) { try { const v = await kvCmd(["GET", MONDAY_KEY]); cohort = v ? JSON.parse(v) : null; } catch { /* noop */ } }
  await saveSnapshot();
  if (!cohort || !Array.isArray(cohort.items) || !cohort.items.length) {
    console.log(`[torecabank] ${WD_LABEL}曜モード: 月曜リストが未作成＝送信スキップ（次の月曜に作成されます）`);
    return;
  }
  html2 = buildUpdateHtml(cohort, byKey, { date });
  subject = `【トレカバンク】月曜リストの金額（${WD_LABEL}曜 ${date}）${cohort.items.length}件`;
  console.log(`[torecabank] ${WD_LABEL}曜モード: 月曜リスト${cohort.items.length}件の現在金額`);
  if (DRY) { fs.writeFileSync("torecabank_preview.html", html2); console.log(`[dry] ${WD_LABEL}曜プレビュー出力 / 件名: ${subject}`); return; }
  await sendMail(subject, html2);
}

main().catch((e) => { console.error("[torecabank] エラー:", e.message); process.exit(1); });
