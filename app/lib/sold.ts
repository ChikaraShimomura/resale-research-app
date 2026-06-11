import { ProfitProduct } from "./profitFilter";

// eBay簡単出品が押された回数の上限。これを超えると「SOLD（出品上限）」扱いにして
// 市場の乱立（ライバル増えすぎ）を防ぐ。avgDaysToSell が短い（早く売れる）ほど上限を高く。
export function getListingLimit(avgDaysToSell?: number | null): number {
  if (avgDaysToSell == null) return 30;
  if (avgDaysToSell < 10) return 100;
  if (avgDaysToSell < 20) return 50;
  if (avgDaysToSell < 30) return 40;
  return 30;
}

// SOLD（出品上限到達 or ダミー）か判定
export function isSold(p: ProfitProduct, liveCount?: number): boolean {
  if (p.soldOut) return true;
  const count = liveCount ?? p.listingCount ?? 0;
  return count >= getListingLimit(p.avgDaysToSell);
}

// ── ダミーSOLD商品（カードはブラー表示されるため内容は概略でよい） ──
const DUMMY_TITLES = [
  "ポケモンカード 強化拡張パック BOX 未開封",
  "ガンプラ MG 1/100 新品未開封 限定",
  "遊戯王 レアリティコレクション BOX シュリンク付",
  "ねんどろいど 限定版 フィギュア 新品",
  "LEGO テクニック 大型セット 新品未開封",
  "セイコー プロスペックス ダイバー 新品",
  "ワンピースカード 頂上決戦 BOX 未開封",
  "一番くじ ラストワン賞 フィギュア",
  "Nintendo Switch 限定ソフト 新品未開封",
  "デュエルマスターズ 王道篇 BOX 未開封",
  "コトブキヤ プラモデル 新品 限定",
  "シャドウバース エボルヴ ブースター BOX",
];

export function makeDummySold(seed: number): ProfitProduct {
  const title = DUMMY_TITLES[seed % DUMMY_TITLES.length];
  const price = 3000 + ((seed * 977) % 9000);
  const rate = 45 + ((seed * 17) % 110);
  const avg = Math.round(price * (1 + rate / 100));
  return {
    id: `dummy-sold-${seed}`,
    title,
    imageUrl: "",
    category: "その他",
    source: { site: "rakuten", siteName: "楽天", price, url: "#", pointRate: 10, pointAmount: Math.floor(price / 10) },
    isNew: true,
    soldOut: true,
    realAvgPrice: avg,
    realProfit: avg - price,
    realProfitRate: rate,
    realCount: 1,
    listingCount: 999,
    addedAt: "2020-01-01T00:00:00.000Z",
  } as ProfitProduct;
}

// SOLD商品が10未満なら、ダミーSOLDを補充してリスト内に点在させる。
// （本番でもプラットフォームを活発に見せるための演出。カードはブラー＋SOLD札で表示）
export function withSoldDummies(products: ProfitProduct[], target = 10): ProfitProduct[] {
  // 実商品が無い（空カタログ・読込中）ときはダミーを出さない
  if (products.length === 0) return products;
  const soldCount = products.filter((p) => isSold(p)).length;
  if (soldCount >= target) return products;

  const need = target - soldCount;
  const dummies = Array.from({ length: need }, (_, i) => makeDummySold(i));

  // 数件ごとにダミーを差し込んで点在させる
  const gap = Math.max(2, Math.floor(products.length / (need + 1)) || 2);
  const out: ProfitProduct[] = [];
  let di = 0;
  products.forEach((p, i) => {
    out.push(p);
    if (di < dummies.length && (i + 1) % gap === 0) out.push(dummies[di++]);
  });
  while (di < dummies.length) out.push(dummies[di++]); // 余りは末尾
  return out;
}
