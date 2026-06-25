#!/usr/bin/env node
// scripts/used/estimateA.mjs
// 【A(ハードオフ)の商品数を実測】中古に強いカテゴリで「eBay中古落札相場 × ハードオフ現在庫」を突合し、
// 送料/関税/手数料後に利益が出るハードオフ出品が何件あるかを数える。住宅IP・低頻度(逐次+待ち)。
import { fetchHardoff } from "./fetchHardoff.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USD_JPY = 155;

// 中古でeBay輸出が強いカテゴリ（ハードオフが厚い：音響/カメラ/楽器/古着/ホビー）。
const QUERIES = [
  { ebay: "Pioneer amplifier", hardoff: "Pioneer アンプ" },
  { ebay: "Marantz amplifier", hardoff: "Marantz アンプ" },
  { ebay: "Sansui amplifier", hardoff: "SANSUI アンプ" },
  { ebay: "Technics turntable", hardoff: "Technics ターンテーブル" },
  { ebay: "Nikon film camera", hardoff: "Nikon フィルムカメラ" },
  { ebay: "Canon FD lens", hardoff: "Canon レンズ" },
  { ebay: "Pentax lens", hardoff: "PENTAX レンズ" },
  { ebay: "Olympus OM camera", hardoff: "OLYMPUS カメラ" },
  { ebay: "Roland synthesizer", hardoff: "Roland シンセ" },
  { ebay: "Boss guitar effects pedal", hardoff: "BOSS エフェクター" },
  { ebay: "Korg synthesizer", hardoff: "KORG シンセ" },
  { ebay: "Yamaha electric guitar japan", hardoff: "YAMAHA エレキギター" },
  { ebay: "Levis 501 vintage denim", hardoff: "リーバイス 501" },
  { ebay: "Seiko vintage automatic watch", hardoff: "セイコー 自動巻" },
  { ebay: "Bandai Soul of Chogokin", hardoff: "超合金魂" },
];

let EBAY_COOKIE = "";
async function ebayWarmup() {
  try {
    const t = await fetch("https://www.ebay.com/", { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15000) });
    EBAY_COOKIE = (t.headers.get("set-cookie") || "").match(/[^;,\s]+=[^;,\s]+/g)?.join("; ") || "";
  } catch { /* noop */ }
}
// eBay落札の中央値(JPY)。日本IPからは価格がJPY表記。広告/外れ値は除外。warmupは1回だけ(外で実行)。
async function ebaySoldMedianJPY(kw) {
  const u = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(kw)}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: EBAY_COOKIE }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { console.log(`     [eBay HTTP ${r.status}]`); return null; }
  const b = await r.text();
  let vals = [...b.matchAll(/JPY\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((v) => v >= 800 && v <= 3000000);
  if (vals.length < 4) {
    // JPYが取れない時は$表記→×レート
    vals = [...b.matchAll(/\$\s?([\d,]+\.\d{2})/g)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * USD_JPY)).filter((v) => v >= 800 && v <= 3000000);
  }
  if (vals.length < 4) return null;
  vals.sort((a, b) => a - b);
  const raw = vals[Math.floor(vals.length / 2)];
  const kept = vals.filter((v) => v >= raw * 0.3 && v <= raw * 3).sort((a, b) => a - b);
  return kept.length ? kept[Math.floor(kept.length / 2)] : raw;
}

// 送料/関税/eBay手数料後の純利益(JPY)。買い=ハードオフ価格、売り=eBay落札中央値。重量500g想定。
function netProfitJPY(buyJpy, sellJpy) {
  const fee = sellJpy * 0.1325 + 47;            // eBay最終手数料
  const shipFee = 2040 * 0.1325;                // 国際送料(エアパケ500g)にかかる手数料(送料自体は買い手負担)
  const dutyJpy = sellJpy / USD_JPY > 100 ? sellJpy * 0.1 + 230 : 0; // $100超はDDP前払い
  return sellJpy - fee - shipFee - dutyJpy - buyJpy;
}

(async () => {
  let totalListings = 0, totalProfitable = 0;
  console.log("カテゴリ                eBay中央値   ハ件数  利益◎  例");
  await ebayWarmup();
  for (const q of QUERIES) {
    let ebay = null, items = [];
    try { ebay = await ebaySoldMedianJPY(q.ebay); } catch { /* skip */ }
    await sleep(2000);
    try { items = await fetchHardoff(q.hardoff); } catch { /* skip */ }
    await sleep(7000); // eBayを連続で叩きすぎないよう間隔(eBay→eBayで約9s)
    if (!ebay || !items.length) { console.log(`${q.hardoff.padEnd(22)} ${ebay ? "¥" + ebay : "取得不可"}  (ハ${items.length})`); continue; }
    let profitable = 0, sample = "";
    for (const it of items) {
      if (!it.price) continue;
      const net = netProfitJPY(it.price, ebay);
      if (net > 1000 && net / ebay > 0.1) { // 純利益>¥1000 かつ >10%
        profitable++;
        if (!sample) sample = `${it.brand} ${it.name} 買¥${it.price}→売¥${ebay} 益¥${Math.round(net)}[${it.condition}]`;
      }
    }
    totalListings += items.length; totalProfitable += profitable;
    console.log(`${q.hardoff.padEnd(22)} ¥${String(ebay).padEnd(9)} ${String(items.length).padStart(4)}   ${String(profitable).padStart(4)}   ${sample}`);
  }
  console.log(`\n=== 合計: ハードオフ出品 ${totalListings}件中、利益が出る ${totalProfitable}件（このサンプル15カテゴリ・各最大30件） ===`);
  console.log(`※eBay相場はカテゴリ集計の中央値(機種別でなく粗い)・状態未加味。実数は機種別マッチで上下する。`);
})();
