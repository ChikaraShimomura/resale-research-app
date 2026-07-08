// トレカバンクの「本日の買取表」から、残り点数が一定数以上の商品を抽出して毎日メールする個人用ツール。
// 依存ゼロ（Node18+ の fetch のみ）。データはページHTMLに `const allProducts = [...]` として埋め込まれているので、
// APIキーもヘッドレスブラウザも不要＝サーバー(GitHub Actions)取得だけで全件取れる。
//
// 価格の前日比・前週比つき：毎回、全商品の買取額を KV に「1日1キー」で保存し（tb_price_snap:YYYY-MM-DD）、
// 前日ぶん(-1日)・前週ぶん(-7日)を読んで差分（▲上昇/▼下落/±0/NEW）を表示する。書き込みは1回/日＝KV負荷ほぼゼロ。
// 履歴が貯まるまで（初日/1週間未満）は該当欄が「—」や「NEW」になる。
//
// 送信は Resend（自社ドメイン yushutsu-fukugyo.com）。RESEND_API_KEY 未設定 or `--dry` ならメールは送らず
// プレビューHTMLをファイル出力＋サマリ表示（非破壊）。KV未設定なら履歴は「—」のまま（送信自体は動く）。
//
// env:
//   RESEND_API_KEY     Resend のAPIキー（無ければ dry 実行）
//   MAIL_FROM          差出人（既定: トレカバンク買取ウォッチ <noreply@yushutsu-fukugyo.com>）
//   MAIL_TO            宛先（既定: chikara0323@gmail.com・カンマ区切りで複数可）
//   MAIL_BCC           追加宛先（Bcc＝お互い非表示・カンマ区切りで複数可）
//   MIN_REMAINING      残り点数の下限（既定: 10）
//   MAX_PRICE          買取額の上限・円（既定: 50000＝5万円以下のみ・高額品は仕入れ非現実的なので除外）
//   EXCLUDE_BOX        "0"で未開封BOXも含める（既定はBOX除外＝BOX以外のみ・ユーザー指示）
//   KV_REST_API_URL    Upstash/Vercel KV のRESTエンドポイント（価格履歴＋本日送信済みガードに使用）
//   KV_REST_API_TOKEN  同トークン（両方揃った時だけ履歴/ガードON）
//   FORCE_SEND         "1"で「本日送信済み」ガードを無視して必ず送る（手動再送用）
//
// 使い方: node scripts/torecabankKaitoriMail.mjs        （送信 or キー無ければdry）
//         node scripts/torecabankKaitoriMail.mjs --dry  （必ずプレビューのみ）

import fs from "node:fs";

const SOURCE_URL = "https://store.torecabank.com/kaitori_list";
const BASE = "https://store.torecabank.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MIN_REMAINING = Number(process.env.MIN_REMAINING || 10);
const MAX_PRICE = Number(process.env.MAX_PRICE || 50000); // 買取額の上限（既定5万円）。高額品は仕入れ非現実的なので除外
const EXCLUDE_BOX = process.env.EXCLUDE_BOX !== "0"; // 既定=未開封BOX除外(BOX以外のみ・ユーザー指示)。BOXも含めるなら EXCLUDE_BOX=0
const MAIL_FROM = process.env.MAIL_FROM || "トレカバンク買取ウォッチ <noreply@yushutsu-fukugyo.com>";
const parseAddrs = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const MAIL_TO = process.env.MAIL_TO || "chikara0323@gmail.com";
const MAIL_BCC = process.env.MAIL_BCC || ""; // 追加宛先（Bcc＝お互い非表示・カンマ区切りで複数可）
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;
const FORCE = process.argv.includes("--force") || process.env.FORCE_SEND === "1"; // 本日送信済みガードを無視して必ず送る（手動再送）

const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_ON = Boolean(KV_URL && KV_TOKEN);
const SNAP_KEY = (day) => `tb_price_snap:${day}`;
const SNAP_TTL = 14 * 24 * 60 * 60; // 履歴は14日保持（前日/前週比に十分＋自動失効でゴミが残らない）
const SENT_KEY = (day) => `tb_sent:${day}`;   // 本日分の送信済みフラグ（cron2本の二重送信を防ぐ）
const SENT_TTL = 2 * 24 * 60 * 60;

const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// 商品の同一性キー（日をまたいだ価格比較用）。グレード＋セット＋番号＋名前で安定させる。
const keyOf = (p) => `${p.product_type_name}|${p.product_master_key1}|${p.product_master_key2}|${p.product_master_name}`;
// JSTの日付(YYYY-MM-DD)。offsetDaysで前日(-1)/前週(-7)。
const jstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

// Upstash/Vercel KV の REST を直叩き（@vercel/kv 非依存＝npm install不要）。コマンドはJSON配列。
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

// HTML内の `const allProducts = [ ... ]` を括弧の深さで正確に切り出してJSON.parseする。
function extractProducts(html) {
  const marker = "const allProducts = ";
  const i = html.indexOf(marker);
  if (i < 0) throw new Error("allProducts marker not found（サイト構造が変わった可能性）");
  const start = html.indexOf("[", i);
  let depth = 0, inStr = false, escChar = false, end = -1;
  for (let p = start; p < html.length; p++) {
    const c = html[p];
    if (inStr) {
      if (escChar) escChar = false;
      else if (c === "\\") escChar = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) throw new Error("allProducts array end not found");
  return JSON.parse(html.slice(start, end + 1));
}

// 前日/前週マップ(key→価格)を使って差分セルのHTMLを返す。マップ無し=「—」、前に無い商品=「NEW」。
function deltaCell(today, map, key) {
  if (!map) return `<span style="color:#cbd5e1">—</span>`;
  const prev = map[key];
  if (prev == null) return `<span style="color:#3b82f6">NEW</span>`;
  const d = Number(today) - Number(prev);
  if (d === 0) return `<span style="color:#9ca3af">±0</span>`;
  const up = d > 0;
  return `<span style="color:${up ? "#16a34a" : "#ef4444"};font-weight:700">${up ? "▲ +" : "▼ -"}${yen(Math.abs(d))}</span>`;
}

function buildHtml(rows, meta, prevMap, weekMap) {
  const boxCount = rows.filter((p) => /BOX/i.test(p.product_type_name)).length;
  const histNote = meta.kvOn
    ? "価格の 前日比／前週比 つき（履歴が貯まるまで一部 — / NEW 表示）。"
    : "※価格履歴(KV)が未設定のため前日比/前週比は「—」です。";
  const head = `
    <div style="font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B">
      <h2 style="font-size:17px;margin:0 0 4px">トレカバンク 買取ウォッチ（残り${MIN_REMAINING}点以上）</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6">
        ${meta.date} 時点 ／ 対象 <b>${rows.length}件</b>（買取${yen(MAX_PRICE)}以下${EXCLUDE_BOX ? "・未開封BOX除外" : `・BOX含む(${boxCount})`}）<br>
        ${histNote}<br>
        ※ グレード品(PSA10等)の買取額は鑑定済み前提です。Mercariで仕入れる際はグレードを合わせること。
      </p>`;
  const body = rows
    .map((p) => {
      const img = BASE + String(p.image_path || "").replace(/^\/+/, "");
      const sub = [p.product_master_key1, p.product_master_key2].filter(Boolean).join(" ");
      const isBox = /BOX/i.test(p.product_type_name);
      const k = keyOf(p);
      return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;width:56px">
          <img src="${esc(img)}" alt="" width="52" height="52" style="width:52px;height:52px;object-fit:cover;border-radius:6px;background:#f3f4f6">
        </td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee">
          <div style="font-size:13px;font-weight:700;line-height:1.4">${esc(p.product_master_name)}</div>
          <div style="font-size:11px;color:#9ca3af">${esc(sub)}
            <span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;color:#fff;background:${isBox ? "#0d9488" : "#A98B5C"}">${esc(p.product_type_name)}</span>
          </div>
        </td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
          <div style="font-size:14px;font-weight:800">${yen(p.buy_price)}</div>
          <div style="font-size:11px;color:#ef4444;font-weight:700">残${esc(p.remaining_quantity)}点</div>
          <div style="font-size:10px;margin-top:3px;color:#9ca3af">前日 ${deltaCell(p.buy_price, prevMap, k)}</div>
          <div style="font-size:10px;color:#9ca3af">前週 ${deltaCell(p.buy_price, weekMap, k)}</div>
        </td>
      </tr>`;
    })
    .join("");
  return `${head}
      <table style="width:100%;border-collapse:collapse">${body}</table>
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">出典: <a href="${SOURCE_URL}" style="color:#6b7280">store.torecabank.com/kaitori_list</a>（自動取得）</p>
    </div>`;
}

async function main() {
  // 本日送信済みガード（自動実行のみ）。cron2本目や再実行での二重送信を防ぐ。手動(FORCE)/dryは対象外。
  if (!DRY && !FORCE && KV_ON) {
    try {
      const already = await kvCmd(["GET", SENT_KEY(jstDay(0))]);
      if (already) { console.log(`[torecabank] 本日分は送信済み（${SENT_KEY(jstDay(0))}）＝スキップ`); return; }
    } catch (e) { console.warn("[guard] 送信済み確認に失敗（続行）:", e.message); }
  }

  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const html = await res.text();
  const all = extractProducts(html);

  // 全商品の価格スナップショット（key→価格）。履歴保存＆前日/前週比の突き合わせに使う（フィルタ前の全件）。
  const todayMap = {};
  for (const p of all) todayMap[keyOf(p)] = Number(p.buy_price);

  // 前日/前週の価格マップを読む（KVが有効な時だけ。失敗しても履歴なし扱いでメールは続行）。
  let prevMap = null, weekMap = null;
  if (KV_ON) {
    try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-1))]); prevMap = v ? JSON.parse(v) : null; } catch (e) { console.warn("[kv] 前日読み込み失敗:", e.message); }
    try { const v = await kvCmd(["GET", SNAP_KEY(jstDay(-7))]); weekMap = v ? JSON.parse(v) : null; } catch (e) { console.warn("[kv] 前週読み込み失敗:", e.message); }
  }

  const rows = all
    .filter((p) => Number(p.remaining_quantity) >= MIN_REMAINING && Number(p.buy_price) <= MAX_PRICE && !(EXCLUDE_BOX && /BOX/i.test(p.product_type_name)))
    .sort((a, b) => Number(b.buy_price) - Number(a.buy_price));

  const date = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  const boxCount = all.filter((p) => Number(p.remaining_quantity) >= MIN_REMAINING && Number(p.buy_price) <= MAX_PRICE && /BOX/i.test(p.product_type_name)).length;
  console.log(`[torecabank] 全${all.length}件 → 残り${MIN_REMAINING}点以上・${yen(MAX_PRICE)}以下${EXCLUDE_BOX ? "・BOX除外" : ""} ${rows.length}件（除外BOX ${boxCount}件）／履歴 前日:${prevMap ? "有" : "無"} 前週:${weekMap ? "有" : "無"}`);
  const html2 = buildHtml(rows, { date, kvOn: KV_ON }, prevMap, weekMap);
  const subject = `【トレカバンク買取】${rows.length}件（残り${MIN_REMAINING}点↑・${yen(MAX_PRICE)}以下${EXCLUDE_BOX ? "・BOX除外" : ""}・${date}）`;

  // 今日のスナップショットを保存（本番のみ・1日1キー＝書き込み1回）。次回以降の前日/前週比に使う。
  if (KV_ON && !DRY) {
    try {
      await kvCmd(["SET", SNAP_KEY(jstDay(0)), JSON.stringify(todayMap), "EX", String(SNAP_TTL)]);
      console.log(`[kv] スナップショット保存: ${SNAP_KEY(jstDay(0))}（${Object.keys(todayMap).length}件）`);
    } catch (e) {
      console.warn("[kv] スナップショット保存失敗:", e.message);
    }
  }

  if (DRY) {
    fs.writeFileSync("torecabank_preview.html", html2);
    console.log(`[dry] 送信せずプレビュー出力: torecabank_preview.html`);
    console.log(`[dry] 件名: ${subject}`);
    console.log("[dry] 上位5件:");
    rows.slice(0, 5).forEach((p) => console.log(`  ${yen(p.buy_price)} 残${p.remaining_quantity}点 [${p.product_type_name}] ${p.product_master_name}`));
    return;
  }

  const toList = parseAddrs(MAIL_TO);
  const bccList = parseAddrs(MAIL_BCC);
  const payload = { from: MAIL_FROM, to: toList, subject, html: html2 };
  if (bccList.length) payload.bcc = bccList; // 追加宛先はBccでお互い非表示
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Resend send failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  console.log(`[torecabank] メール送信完了 → to:${toList.join(",")}${bccList.length ? " / bcc:" + bccList.join(",") : ""}（${rows.length}件）`);
  // 送信済みフラグを立てる＝同じ日の予備cron/再実行はスキップされる。
  if (KV_ON) { try { await kvCmd(["SET", SENT_KEY(jstDay(0)), "1", "EX", String(SENT_TTL)]); } catch (e) { console.warn("[guard] 送信済み記録に失敗:", e.message); } }
}

main().catch((e) => { console.error("[torecabank] エラー:", e.message); process.exit(1); });
