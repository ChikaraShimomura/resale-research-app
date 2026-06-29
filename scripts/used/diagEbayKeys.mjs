#!/usr/bin/env node
// scripts/used/diagEbayKeys.mjs
// eBay競合数が取れない(ebayCompetition=null)時の原因切り分け。
// ① client_credentials トークン取得 ② Browse 検索 の各HTTPステータス/eBayエラーを表に出す。
// 機微を伏せた要約を KV(wlog:ebaydiag) にも push＝PC側から遠隔確認できる。★秘密(Cert ID/token)はKVにも画面にも全出ししない。
// 使い方: node scripts/used/diagEbayKeys.mjs
import fs from "node:fs";
function envv(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const APP = envv("EBAY_APP_ID"), SEC = envv("EBAY_CLIENT_SECRET");
const KV_URL = envv("KV_REST_API_URL") || envv("UPSTASH_REDIS_REST_URL");
const KV_TOK = envv("KV_REST_API_TOKEN") || envv("UPSTASH_REDIS_REST_TOKEN");
const mask = (s) => (!s ? "(空)" : `${s.slice(0, 9)}…(${s.length}字)`); // App IDは公開IDなので先頭だけ可。Cert IDは長さのみ。

async function push(o) {
  if (!KV_URL || !KV_TOK) return;
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", "wlog:ebaydiag", JSON.stringify(o), "EX", String(7 * 24 * 3600)]]),
    });
  } catch { /* noop */ }
}

(async () => {
  const out = { at: new Date().toISOString(), appId: mask(APP), secretLen: SEC ? SEC.length : 0 };
  console.log("EBAY_APP_ID:", out.appId, "/ EBAY_CLIENT_SECRET:", SEC ? `設定あり(${SEC.length}字)` : "(空)");
  if (!APP || !SEC) { out.result = "鍵が空"; await push(out); console.log("→ 鍵が空。.env.local を確認。"); return; }

  // ① トークン取得
  let token = null;
  try {
    const enc = Buffer.from(`${APP}:${SEC}`).toString("base64");
    const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${enc}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      signal: AbortSignal.timeout(15000),
    });
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { /* noop */ }
    out.tokenStatus = r.status;
    out.tokenErr = j.error || j.error_description || (r.ok ? "" : t.slice(0, 200)) || "";
    console.log("① token HTTP:", r.status, r.ok ? "OK" : `NG → ${out.tokenErr}`);
    if (r.ok) token = j.access_token;
  } catch (e) { out.tokenStatus = "ERR"; out.tokenErr = e.message; console.log("① token 例外:", e.message); }

  // ② Browse 検索
  if (token) {
    try {
      const p = new URLSearchParams({ q: "ROLAND JC 120", limit: "1", fieldgroups: "COMPACT" });
      const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${p}`, {
        headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
        signal: AbortSignal.timeout(15000),
      });
      const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { /* noop */ }
      out.searchStatus = r.status; out.total = j.total;
      out.searchErr = r.ok ? "" : (j.errors ? JSON.stringify(j.errors).slice(0, 300) : t.slice(0, 300));
      console.log("② Browse HTTP:", r.status, r.ok ? `OK total=${j.total}` : `NG → ${out.searchErr}`);
    } catch (e) { out.searchStatus = "ERR"; out.searchErr = e.message; console.log("② Browse 例外:", e.message); }
  }
  out.result = out.searchStatus === 200 ? "OK" : (token ? "検索NG" : "トークンNG");
  await push(out);
  console.log("→ 要約を KV(wlog:ebaydiag) に保存（PC側から確認可能）。");
})();
