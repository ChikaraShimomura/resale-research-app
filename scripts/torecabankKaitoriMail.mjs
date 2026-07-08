// トレカバンクの「本日の買取表」から、残り点数が一定数以上の商品を抽出して毎日メールする個人用ツール。
// 依存ゼロ（Node18+ の fetch のみ）。データはページHTMLに `const allProducts = [...]` として埋め込まれているので、
// APIキーもヘッドレスブラウザも不要＝サーバー(GitHub Actions)取得だけで全件取れる。
//
// 送信は Resend（自社ドメイン yushutsu-fukugyo.com）。RESEND_API_KEY 未設定 or `--dry` ならメールは送らず
// プレビューHTMLをファイル出力＋サマリ表示（非破壊）。
//
// env:
//   RESEND_API_KEY  Resend のAPIキー（無ければ dry 実行）
//   MAIL_FROM       差出人（既定: トレカバンク買取ウォッチ <noreply@yushutsu-fukugyo.com>）
//   MAIL_TO         宛先（既定: chikara0323@gmail.com）
//   MIN_REMAINING   残り点数の下限（既定: 10）
//
// 使い方: node scripts/torecabankKaitoriMail.mjs        （送信 or キー無ければdry）
//         node scripts/torecabankKaitoriMail.mjs --dry  （必ずプレビューのみ）

import fs from "node:fs";

const SOURCE_URL = "https://store.torecabank.com/kaitori_list";
const BASE = "https://store.torecabank.com/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MIN_REMAINING = Number(process.env.MIN_REMAINING || 10);
const MAIL_FROM = process.env.MAIL_FROM || "トレカバンク買取ウォッチ <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = process.env.MAIL_TO || "chikara0323@gmail.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const DRY = process.argv.includes("--dry") || !RESEND_API_KEY;

const yen = (n) => "¥" + Number(n || 0).toLocaleString("ja-JP");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

function buildHtml(rows, meta) {
  const boxCount = rows.filter((p) => /BOX/i.test(p.product_type_name)).length;
  const head = `
    <div style="font-family:'Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#2D323B">
      <h2 style="font-size:17px;margin:0 0 4px">トレカバンク 買取ウォッチ（残り${MIN_REMAINING}点以上）</h2>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;line-height:1.6">
        ${meta.date} 時点 ／ 対象 <b>${rows.length}件</b>（うち未開封BOX <b>${boxCount}件</b>＝Mercari転売で現実的）<br>
        ※ PSA10は鑑定済み前提の買取額です。Mercariの未鑑定(raw)品とは別物なのでご注意を。
      </p>`;
  const body = rows
    .map((p) => {
      const img = BASE + String(p.image_path || "").replace(/^\/+/, "");
      const sub = [p.product_master_key1, p.product_master_key2].filter(Boolean).join(" ");
      const isBox = /BOX/i.test(p.product_type_name);
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
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": UA, "Accept-Language": "ja" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const html = await res.text();
  const all = extractProducts(html);
  const rows = all
    .filter((p) => Number(p.remaining_quantity) >= MIN_REMAINING)
    .sort((a, b) => Number(b.buy_price) - Number(a.buy_price));

  const date = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  const boxCount = rows.filter((p) => /BOX/i.test(p.product_type_name)).length;
  console.log(`[torecabank] 全${all.length}件 → 残り${MIN_REMAINING}点以上 ${rows.length}件（未開封BOX ${boxCount}件）`);
  const html2 = buildHtml(rows, { date });
  const subject = `【トレカバンク買取】残り${MIN_REMAINING}点以上 ${rows.length}件（${date}）`;

  if (DRY) {
    fs.writeFileSync("torecabank_preview.html", html2);
    console.log(`[dry] 送信せずプレビュー出力: torecabank_preview.html`);
    console.log(`[dry] 件名: ${subject}`);
    console.log("[dry] 上位5件:");
    rows.slice(0, 5).forEach((p) => console.log(`  ${yen(p.buy_price)} 残${p.remaining_quantity}点 [${p.product_type_name}] ${p.product_master_name}`));
    return;
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, subject, html: html2 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Resend send failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  console.log(`[torecabank] メール送信完了 → ${MAIL_TO}（${rows.length}件）`);
}

main().catch((e) => { console.error("[torecabank] エラー:", e.message); process.exit(1); });
