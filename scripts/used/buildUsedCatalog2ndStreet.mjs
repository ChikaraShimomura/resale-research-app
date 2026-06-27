#!/usr/bin/env node
// scripts/used/buildUsedCatalog2ndStreet.mjs
// 【中古カタログ B: 2nd STREET 古着】eBay古着の落札相場(Pixel発掘の ebay_sold_seed・demand) × 2nd STREET現在庫(supply)
// → 純利益で「儲かる古着」を抽出し、used_catalog に追記(マージ)する。⚠️PC(GUIあり)限定＝2nd STは実Chrome headed必須。
// 古着のeBay相場は捏造しない＝ebayQueries.mjs に足した古着ヴィンテージ語を Pixel が集めた実データだけを使う
// （キャッシュに該当カテゴリが無ければスキップ＝Pixelの落札発掘が回るまでは0件。回れば自動で古着が乗る）。
import fs from "node:fs";
import { fetch2ndStreetMany } from "./fetch2ndStreet.mjs";

const USD_JPY = 155;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function env(k) {
  const e = fs.readFileSync(".env.local", "utf8");
  const m = e.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}
const KV_URL = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
const KV_TOK = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");

// eBay発掘カテゴリ(ebayQueries.mjsのname) → 2nd STREETの日本語検索語。
const KOFUKU = [
  { cat: "リーバイス501ヴィンテージ", q: "リーバイス 501" },
  { cat: "リーバイストラッカー", q: "リーバイス トラッカー" },
  { cat: "チャンピオンリバースウィーブ", q: "チャンピオン リバースウィーブ" },
  { cat: "カーハートヴィンテージ", q: "カーハート" },
  { cat: "パタゴニアフリース", q: "パタゴニア フリース" },
  { cat: "ナイキヴィンテージ", q: "ナイキ ナイロンジャケット" },
  { cat: "ステューシーヴィンテージ", q: "ステューシー" },
  { cat: "ハーレーヴィンテージT", q: "ハーレーダビッドソン Tシャツ" },
  { cat: "ノースフェイスヴィンテージ", q: "ノースフェイス ヌプシ" },
  { cat: "コムデギャルソン", q: "コムデギャルソン" },
  { cat: "ヨウジヤマモト", q: "ヨウジヤマモト" },
  { cat: "ラルフローレンヴィンテージ", q: "ラルフローレン" },
];

function netProfitJPY(buyJpy, sellJpy) {
  const fee = sellJpy * 0.1325 + 47;
  const shipFee = 2040 * 0.1325;
  const dutyJpy = sellJpy / USD_JPY > 100 ? sellJpy * 0.1 + 230 : 0;
  return Math.round(sellJpy - fee - shipFee - dutyJpy - buyJpy);
}

(async () => {
  // 1) キャッシュから古着カテゴリのeBay中央値を引く（Pixelが集めていなければ空）。
  const r = await fetch(`${KV_URL}/get/ebay_sold_seed`, { headers: { Authorization: `Bearer ${KV_TOK}` } });
  const seed = JSON.parse((await r.json()).result || "[]");
  const medByCat = {};
  for (const s of seed) {
    if (!s.category || !s.priceJpy) continue;
    (medByCat[s.category] = medByCat[s.category] || []).push(s.priceJpy);
  }
  const targets = KOFUKU.filter((k) => Array.isArray(medByCat[k.cat]) && medByCat[k.cat].length >= 3)
    .map((k) => {
      const ps = medByCat[k.cat].slice().sort((a, b) => a - b);
      return { ...k, ebayMedian: ps[Math.floor(ps.length / 2)] };
    });

  if (targets.length === 0) {
    console.log("古着のeBay相場(ebay_sold_seed)がまだ無い → Pixelの落札発掘が古着キーワードを集めるまで0件。");
    console.log("（ebayQueries.mjs に古着ヴィンテージ語は追加済み。Pixelの次サイクルで集まる）");
    return;
  }
  console.log(`対象古着カテゴリ ${targets.length}件（eBay相場あり）:`, targets.map((t) => `${t.cat}¥${t.ebayMedian}`).join(" "));

  // 2) 2nd STREET(実Chrome headed)で供給を取り、純利益で抽出。
  const added = [];
  await fetch2ndStreetMany(targets.map((t) => t.q), {
    gapMs: 4000,
    onResult: (kw, items) => {
      const t = targets.find((x) => x.q === kw);
      if (!t) return;
      let n = 0;
      for (const it of items) {
        if (!it.price) continue;
        const ratio = it.price / t.ebayMedian;
        if (ratio < 0.12 || ratio > 0.75) continue; // 極端なミスマッチ除外
        const net = netProfitJPY(it.price, t.ebayMedian);
        const roi = it.price > 0 ? net / it.price : 0; // 利益率＝純利益÷仕入れ値(ROI)。配信(getUsedCatalog)と同じ定義で判定する。
        if (net > 1500 && roi >= 0.1) {
          added.push({
            modelKey: (it.name || "").slice(0, 60), brand: it.brand, name: `${it.name}${it.size ? " " + it.size : ""}`,
            code: "", cat: "古着", ebayMedianJpy: t.ebayMedian, buyJpy: it.price, condition: it.condition,
            profitJpy: net, profitRate: it.price > 0 ? Math.round((net / it.price) * 100) : 0, hardoffUrl: it.url, imageUrl: it.imageUrl, site: "2ndstreet",
          });
          if (++n >= 4) break;
        }
      }
      console.log(`  +${n} ${t.cat}`);
    },
  });

  // 3) used_catalog に追記マージ（URL重複は除外）。
  const cur = JSON.parse((await (await fetch(`${KV_URL}/get/used_catalog`, { headers: { Authorization: `Bearer ${KV_TOK}` } })).json()).result || "[]");
  const have = new Set(cur.map((x) => x.hardoffUrl));
  const merged = [...cur, ...added.filter((x) => !have.has(x.hardoffUrl))].sort((a, b) => b.profitJpy - a.profitJpy);
  await fetch(`${KV_URL}/set/used_catalog`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(merged) });
  console.log(`\n古着 ${added.length}件を追加 → used_catalog 計 ${merged.length}件`);
})();
