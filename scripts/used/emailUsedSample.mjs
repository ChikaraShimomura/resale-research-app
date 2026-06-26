#!/usr/bin/env node
// scripts/used/emailUsedSample.mjs
// KV `used_catalog`（中古の利益カタログ）を読み、上位をHTML表にしてResendでメール送信する。
// スクレイピングはしない（KV読み＋Resendのみ＝クラウド/DC IPでも動く）。GitHub Actionsから secrets で実行。
// 必要env: KV_REST_API_URL / KV_REST_API_TOKEN / RESEND_API_KEY / (任意)SAMPLE_TO
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND = process.env.RESEND_API_KEY;
const TO = process.env.SAMPLE_TO || "chikara0323@gmail.com";

if (!KV_URL || !KV_TOK || !RESEND) {
  console.error("env不足: KV_REST_API_URL/KV_REST_API_TOKEN/RESEND_API_KEY が要る");
  process.exit(1);
}

const r = await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } });
const catalog = JSON.parse((await r.json()).result || "[]");
if (!Array.isArray(catalog) || catalog.length === 0) {
  console.error("used_catalog が空。先に buildUsedSampleFromCache を回すこと。");
  process.exit(1);
}
catalog.sort((a, b) => b.profitJpy - a.profitJpy);

// eBay落札(根拠)の検索URL。型番リファイナが入れた ebaySoldUrl 優先、無ければ ブランド+型番 で検索。
const ebaySold = (c) =>
  c.ebaySoldUrl ||
  `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent([c.brand, c.code].filter(Boolean).join(" ") || [c.brand, c.name].filter(Boolean).join(" "))}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=3000&_sop=13`;

const rows = catalog.slice(0, 40).map((c) =>
  `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${c.cat}</td><td style="padding:4px 8px;border-bottom:1px solid #eee">${c.brand} ${c.name}${c.code ? "（" + c.code + "）" : ""}${c.ebayConfirmed ? ' <span style="color:#0a8a4a;font-size:11px">型番一致</span>' : ""}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${c.condition || "中古"}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">¥${(c.buyJpy || 0).toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;color:#0064D2">¥${(c.ebayMedianJpy || 0).toLocaleString()}${c.soldCount ? `<br><span style="color:#999;font-size:10px">落札${c.soldCount}件</span>` : ""}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:#A98B5C">+¥${(c.profitJpy || 0).toLocaleString()}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${c.profitRate}%</td><td style="padding:4px 8px;border-bottom:1px solid #eee"><a href="${c.hardoffUrl}">仕入れ</a><br><a href="${ebaySold(c)}" style="color:#0064D2">eBay落札</a></td></tr>`
).join("");
const html = `<div style="font-family:sans-serif;color:#2D323B">
<h2>中古の利益カタログ サンプル（${catalog.length}件）</h2>
<p>eBay落札の実データ（Pixel収集）× ハードオフ現在庫で、送料・関税・手数料を引いた純利益で抽出した「儲かる中古」の上位40件です。eBay想定売値はカテゴリ（型番系列）中央値ベースの目安、状態・競合・為替で変動します。</p>
<p><b>全${catalog.length}件</b>が利益候補（純益¥1,500超・利益率15%超）。</p>
<table style="border-collapse:collapse;font-size:13px;width:100%">
  <tr style="background:#2D323B;color:#fff"><th style="padding:6px 8px;text-align:left">ジャンル</th><th style="padding:6px 8px;text-align:left">商品</th><th style="padding:6px 8px">状態</th><th style="padding:6px 8px">仕入れ</th><th style="padding:6px 8px">eBay想定</th><th style="padding:6px 8px">純利益</th><th style="padding:6px 8px">率</th><th style="padding:6px 8px">仕入れ先</th></tr>
  ${rows}
</table>
<p style="color:#888;font-size:12px;margin-top:16px">※ 中古は1点物のため在庫は流動的。eBay想定売値は型番系列の中央値（型番単位の精密化はワーカー稼働で順次）。輸出ラボ</p>
</div>`;

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: "輸出ラボBot <noreply@yushutsu-fukugyo.com>", to: [TO], subject: `【輸出ラボ】中古の利益カタログ サンプル ${catalog.length}件`, html }),
});
console.log("Resend:", res.status, (await res.text()).slice(0, 200));
if (!res.ok) process.exit(1);
