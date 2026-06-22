// テストアカウントのKVにデモ取引を仕込む（成績/出品中/売却の本物画面を出すため）。
// 使い方: SEED_ACTOR=acct:<uuid> node video-slides/seedDemo.mjs   （クリアは ARG clear）
import fs from "node:fs";
for (const l of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ACTOR = process.env.SEED_ACTOR;
if (!ACTOR) { console.error("SEED_ACTOR 未設定"); process.exit(1); }
const { kv } = await import("@vercel/kv");
const DEALS = `ebay_deals:${ACTOR}`, SKU = `ebay_sku_map:${ACTOR}`;

if (process.argv[2] === "clear") {
  await kv.del(DEALS); await kv.del(SKU);
  console.log("cleared", DEALS, SKU);
  process.exit(0);
}

const I = "https://thumbnail.image.rakuten.co.jp/@0_mall/";
const img = {
  yugioh: I + "hibinotane/cabinet/imgrc0131735019.jpg?_ex=128x128",
  ac: I + "wlbstore/cabinet/re/re060.jpg?_ex=128x128",
  kobido: I + "kobido/cabinet/08982934/09066424/imgrc0096799840.jpg?_ex=128x128",
  pokemon: I + "kenbill-2/cabinet/hob/12/4934054057047.jpg?_ex=128x128",
  seiko: I + "jw-copal/cabinet/biiino/item/main-image-5/20250602153140_1.jpg?_ex=128x128",
  gunpla: I + "hobby-fun/cabinet/hobby/010/4573102683366-01.jpg?_ex=128x128",
  shiseido: I + "shopqueen/cabinet/shiseido/prior/49099782579652601.jpg?_ex=128x128",
  gshock: I + "one-derfulshop/cabinet/n20260426105005/b0fv1yqt4m-1.jpg?_ex=128x128",
};

// 売却6＋出品中3。soldAtは2026-04〜06に散らして月別グラフを出す。
const deals = {
  demo1: { purchase: 5400, points: 270, title: "遊戯王OCG デュエルモンスターズ DUELIST BOX -PRISMATIC ART COLLECTION-", imageUrl: img.yugioh, listedAt: "2026-06-11T01:00:00.000Z", sku: "rr-demo1", listingId: "286001110001", soldUsd: 78.5, soldAt: "2026-06-18T05:12:00.000Z" },
  demo2: { purchase: 3980, points: 199, title: "資生堂 プリオール 美容液 つけかえ用 リンクルセラム", imageUrl: img.shiseido, listedAt: "2026-05-30T01:00:00.000Z", sku: "rr-demo2", listingId: "286001110002", soldUsd: 49, soldAt: "2026-06-04T09:30:00.000Z" },
  demo3: { purchase: 11800, points: 590, title: "CASIO G-SHOCK GA-700 メンズ腕時計 アナデジ", imageUrl: img.gshock, listedAt: "2026-05-18T01:00:00.000Z", sku: "rr-demo3", listingId: "286001110003", soldUsd: 132, soldAt: "2026-05-26T14:05:00.000Z" },
  demo4: { purchase: 1500, points: 75, title: "SEIKO 20mm 時計ベルト ストラップ RS08R20NY ネイビー", imageUrl: img.seiko, listedAt: "2026-05-03T01:00:00.000Z", sku: "rr-demo4", listingId: "286001110004", soldUsd: 41, soldAt: "2026-05-10T03:40:00.000Z" },
  demo5: { purchase: 2310, points: 115, title: "30MM オプションパーツセット ARMORED CORE VI FIRES OF RUBICON", imageUrl: img.ac, listedAt: "2026-04-14T01:00:00.000Z", sku: "rr-demo5", listingId: "286001110005", soldUsd: 51, soldAt: "2026-04-20T08:20:00.000Z" },
  demo6: { purchase: 4800, points: 240, title: "バンダイ RG 1/144 ガンダム プラモデル", imageUrl: img.gunpla, listedAt: "2026-04-01T01:00:00.000Z", sku: "rr-demo6", listingId: "286001110006", soldUsd: 64, soldAt: "2026-04-06T11:00:00.000Z" },
  demo7: { purchase: 4245, points: 212, title: "ポケモンセンター オリジナル ぬいぐるみ", imageUrl: img.pokemon, listedAt: "2026-06-20T02:00:00.000Z", sku: "rr-demo7", listingId: "286001110007" },
  demo8: { purchase: 6200, points: 310, title: "遊戯王 LIMIT OVER COLLECTION BOX", imageUrl: img.kobido, listedAt: "2026-06-19T02:00:00.000Z", sku: "rr-demo8", listingId: "286001110008" },
  demo9: { purchase: 3200, points: 160, title: "資生堂 ザ・コラーゲン ドリンク", imageUrl: img.shiseido, listedAt: "2026-06-15T02:00:00.000Z", sku: "rr-demo9", listingId: "286001110009", sourceStatus: "soldout", sourceCheckedAt: "2026-06-22T00:00:00.000Z" },
};
const skuMap = {};
for (const id of Object.keys(deals)) skuMap[deals[id].sku] = id;

await kv.hset(DEALS, deals);
await kv.expire(DEALS, 730 * 24 * 3600);
await kv.hset(SKU, skuMap);
await kv.expire(SKU, 730 * 24 * 3600);
console.log("seeded", Object.keys(deals).length, "deals (sold6/live3) for", ACTOR);
