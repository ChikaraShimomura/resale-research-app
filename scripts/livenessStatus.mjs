#!/usr/bin/env node
// 売切ワーカー(住宅IP/スマホ)の死活・結果を PC 側から確認する。
// 使い方: node scripts/livenessStatus.mjs
// スマホのワーカーが毎回 KV に書く liveness_status(最新) / liveness_log(直近) を読むだけ。
import fs from "node:fs";
try {
  const p = new URL("../.env.local", import.meta.url);
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* env から拾える場合は無視 */ }

const U = process.env.KV_REST_API_URL, T = process.env.KV_REST_API_TOKEN, H = { Authorization: `Bearer ${T}` };
if (!U || !T) { console.error("KV env 未設定 (.env.local)"); process.exit(1); }

const j = async (path) => (await (await fetch(`${U}/${path}`, { headers: H })).json()).result;
const parse = (s) => { try { return JSON.parse(s); } catch { return s; } };

const st = parse(await j("get/liveness_status"));
if (!st) { console.log("まだステータスがありません（ワーカーが新版で1回も動いてない可能性）。"); process.exit(0); }

const ageMin = st.at ? Math.round((Date.now() - Date.parse(st.at)) / 60000) : null;
const stale = ageMin != null && ageMin > 130; // 2時間超(毎時のはず)＝止まってる疑い
console.log(`最終実行: ${st.at}  （${ageMin}分前）${stale ? "  ⚠️ 2時間以上更新なし＝ワーカー停止の疑い" : "  ✅ 稼働中とみられる"}`);
console.log(`結果: ${st.note}${st.dry ? "(DRY)" : ""}  生存${st.alive ?? "-"}/売切${st.soldout ?? "-"}/削除${st.dead ?? "-"}/不明${st.unknown ?? "-"}  →カタログ隠す${st.catalogHidden ?? "-"}/戻す${st.catalogRestored ?? "-"}  (${st.durationSec ?? "-"}s)`);

const log = (await j("lrange/liveness_log/0/9")) || [];
if (log.length) {
  console.log("\n直近の実行(売切検知):");
  for (const s of log) {
    const o = parse(s);
    console.log(`  ${o.at}  ${o.note}${o.dry ? "(DRY)" : ""}  売切${o.soldout ?? "-"}/隠す${o.catalogHidden ?? "-"}`);
  }
}

// ギャラリー取得ワーカーの心拍
const g = parse(await j("get/gallery_last_run"));
if (g && g.at) {
  const gMin = Math.round((Date.now() - Date.parse(g.at)) / 60000);
  const gStale = gMin > 12 * 60; // 約6hごと→12h超で疑い
  console.log(`\nギャラリー取得: ${g.at}（${gMin}分前）${gStale ? "  ⚠️ 12h以上更新なし" : "  ✅ 稼働中"}  取得${g.fetched ?? "-"}/空${g.empty ?? "-"}/失敗${g.err ?? "-"}/スキップ${g.skip ?? "-"}`);
} else {
  console.log("\nギャラリー取得: まだ心拍なし(新版ワーカーが1回も回ってない可能性。次サイクルで出ます)");
}
