// scripts/used/ebayCompetition.mjs
// eBay競合数(=現在出品の総数)を公式 Browse API で取得する共有ヘルパー（HTMLスクレイプでない＝captchaなし＝住宅IP不要）。
// 型番リファイナ(refineUsedCatalogEbay)が確定時に焼き込み、バックフィル(backfillCompetition)が既存確定品へまとめて付与/更新する。
// ★フェイルオープン：EBAY_APP_ID/EBAY_CLIENT_SECRET が無ければ null を返して静かにスキップ（落ちない）。
import fs from "node:fs";

function envv(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}

const EBAY_APP_ID = envv("EBAY_APP_ID");
const EBAY_CLIENT_SECRET = envv("EBAY_CLIENT_SECRET");
let ebayTokenCache = null;

// 鍵が揃っているか（呼び出し側が「鍵が無いから今回はスキップ」を判断するため）。
export function hasEbayKeys() {
  return !!(EBAY_APP_ID && EBAY_CLIENT_SECRET);
}

async function getEbayToken() {
  if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) return null; // 鍵が無ければ競合取得はスキップ（fail-open）
  if (ebayTokenCache && Date.now() < ebayTokenCache.expiresAt) return ebayTokenCache.token;
  const encoded = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${encoded}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    ebayTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch { return null; }
}

// 現在出品の総数(=競合の厚み)。limit=1 で total だけ取得＝軽量。取得不可は null(=競合不明=中立)。
export async function ebayCompetition(query) {
  if (!query) return null;
  const token = await getEbayToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({ q: query.slice(0, 120), limit: "1", fieldgroups: "COMPACT" });
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return Number.isFinite(d?.total) ? d.total : null;
  } catch { return null; }
}
