#!/usr/bin/env node
// scripts/used/addSecondStreetWatches.mjs
// 【2nd STREET 時計を候補に追加】2nd STの中古時計を取得し、名前から型番を抽出して used_catalog に追記(候補)。
// その後 refineUsedCatalogEbay が「同一型番の中古落札」で相場確定する。2nd STは高額時計が多く $500以上=AG関税なしと好相性。
// ⚠️PC限定(実Chrome headed)。ハードオフ(build)で used_catalog を作った後にこれを足し、最後に refine する運用：
//    build → addSecondStreetWatches → refine の順。住宅IP・低頻度。
import fs from "node:fs";
import { fetch2ndStreetMany } from "./fetch2ndStreet.mjs";

function env(k) {
  if (process.env[k]) return process.env[k];
  try {
    const e = fs.readFileSync(".env.local", "utf8");
    const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const KV_URL = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const KV_TOK = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
const CAP_PER_KW = Number(process.env.CAP_PER_KW) || 12; // 1キーワードあたり追加上限（env CAP_PER_KW で調整可・上げると候補↑）

// 2nd ST 時計キーワード（型番がeBayに出やすいCASIO＋高額帯を優先）。
const KEYWORDS = [
  "カシオ Gショック", "カシオ オシアナス", "カシオ エディフィス", "カシオ プロトレック",
  "セイコー プロスペックス", "セイコー プレザージュ", "セイコー 5スポーツ", "セイコー アストロン",
  "シチズン プロマスター", "シチズン アテッサ", "オリエント スター", "オリエント",
];

// ブランド正規化（先頭ブランド名を英語に寄せる＝refinerのeBay検索が効く）。
function brandOf(name, kw) {
  const s = `${name} ${kw}`;
  if (/casio|カシオ|g-?shock|gショック|オシアナス|エディフィス|プロトレック/i.test(s)) return "CASIO";
  if (/seiko|セイコー|プロスペックス|プレザージュ|アストロン/i.test(s)) return "SEIKO";
  if (/citizen|シチズン|アテッサ|プロマスター/i.test(s)) return "CITIZEN";
  if (/orient|オリエント/i.test(s)) return "ORIENT";
  return (name.split(/[\s/]/)[0] || "").trim();
}

// 2nd STの名前(スラッシュ区切り)から型番を抽出。例 6R55-00G0 / V157-00A0 / GA-2100 / SBDC001 / 7S26-0050。
function extractModel(name) {
  const segs = String(name || "").split(/[\s/]+/).map((s) => s.trim()).filter(Boolean);
  const dash = /^[0-9A-Z]{2,4}-[0-9A-Z]{2,5}$/i;       // 6R55-00G0 / V157-00A0 / GA-2100 / OCW-T100
  const solid = /^[A-Z]{2,4}[0-9]{2,4}$/i;             // SBDC001 / SARB033
  const hasMix = (s) => /[A-Z]/i.test(s) && /[0-9]/.test(s);
  const cands = segs.filter((s) => hasMix(s) && (dash.test(s) || solid.test(s)));
  // ダッシュ付き(より具体的)を優先、次に長いもの。
  cands.sort((a, b) => (b.includes("-") - a.includes("-")) || (b.length - a.length));
  return cands[0] || "";
}

(async () => {
  const cur = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  const have = new Set(cur.map((x) => x.hardoffUrl));
  const added = [];

  await fetch2ndStreetMany(KEYWORDS, {
    gapMs: 4000,
    onResult: (kw, items) => {
      let n = 0;
      for (const it of items) {
        if (!it.price || !it.url || have.has(it.url)) continue;
        if (/JUNK|ジャンク/i.test(it.condition || "")) continue; // ジャンク(動作未確認)は除外
        const code = extractModel(it.name);
        if (!code) continue; // 型番が取れない品はrefineで確定できない＝入れない
        const brand = brandOf(it.name, kw);
        const id = `used-2ndst-${(it.url.match(/goodsId\/(\d+)/) || [])[1] || it.id}`;
        added.push({
          id, modelKey: code, brand, name: it.name.replace(/\//g, " ").slice(0, 60), code,
          cat: "腕時計", ebayMedianJpy: 0, buyJpy: it.price, condition: it.condition,
          profitJpy: 0, profitRate: 0, hardoffUrl: it.url, imageUrl: it.imageUrl,
          site: "2ndstreet", ebayConfirmed: false, ebayChecked: false,
        });
        have.add(it.url);
        if (++n >= CAP_PER_KW) break;
      }
      console.log(`  +${n} ${kw}`);
    },
  });

  const merged = [...cur, ...added];
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(merged) });
  console.log(`\n2nd ST時計 ${added.length}件を候補追加 → used_catalog 計 ${merged.length}件（要 refine で型番相場確定）`);
})();
