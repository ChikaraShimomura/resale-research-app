import { ProfitProduct } from "./profitFilter";

// 海外発送・通関のための補助情報を商品から自動生成する（純ロジック）。
// 為替は refresh.mjs と合わせる（USD 155円）。
const USD_TO_JPY = 155;

type Cat = "figure" | "card" | "game" | "gunpla" | "lego" | "camera" | "watch" | "anime" | "other";

function detectCategory(title: string): Cat {
  const t = title.toLowerCase();
  if (/フィギュア|figure|figma|nendoroid|ねんどろいど|プライズ|amiibo/.test(t)) return "figure";
  if (/ポケモンカード|pokemon card|遊戯王|yu-gi-oh|トレカ|tcg|デュエル|ワンピースカード|カードゲーム/.test(t)) return "card";
  if (/switch|ps5|ps4|ゲームソフト|ソフト|video game/.test(t)) return "game";
  if (/ガンプラ|gunpla|\bmg\b|\brg\b|\bhg\b|\bpg\b|プラモデル|model kit/.test(t)) return "gunpla";
  if (/lego|レゴ/.test(t)) return "lego";
  if (/カメラ|camera|レンズ|lens|一眼|ミラーレス/.test(t)) return "camera";
  if (/腕時計|時計|watch|seiko|casio|citizen/.test(t)) return "watch";
  if (/アニメ|anime|グッズ|goods|キャラ/.test(t)) return "anime";
  return "other";
}

// 通関用の汎用英語品名 + HSコード目安（※あくまで参考。最終確認は本人）
const CUSTOMS: Record<Cat, { item: string; hs: string }> = {
  figure: { item: "Collectible toy figure", hs: "9503.00" },
  card: { item: "Trading cards", hs: "9504.40" },
  game: { item: "Video game software", hs: "9504.50" },
  gunpla: { item: "Plastic model kit (toy)", hs: "9503.00" },
  lego: { item: "Plastic building block toy", hs: "9503.00" },
  camera: { item: "Camera / optical equipment", hs: "9006.59" },
  watch: { item: "Wristwatch", hs: "9102.11" },
  anime: { item: "Character merchandise (toy)", hs: "9503.00" },
  other: { item: "Japanese collectible merchandise", hs: "9503.00" },
};

export interface ShippingHelp {
  itemDescriptionEn: string; // 通関の品名（英語）
  contentType: string; // 内容種別
  declaredValueUsd: number; // 申告価格（USD）
  hsCode: string; // HSコード目安
  quantity: number;
  method: string; // 推奨発送方法
  methodNote: string;
}

export function shippingHelp(product: ProfitProduct): ShippingHelp {
  const cat = detectCategory(product.title);
  const c = CUSTOMS[cat];
  const valueUsd = Math.max(1, Math.round(product.realAvgPrice / USD_TO_JPY));

  // 価格帯で発送方法を提案（高額は追跡・補償ありのEMS）
  let method: string;
  let methodNote: string;
  if (valueUsd >= 120) {
    method = "EMS（国際スピード郵便）";
    methodNote = "高額なので追跡＋補償ありのEMSが安心。";
  } else if (valueUsd >= 30) {
    method = "eパケット（ePacket）";
    methodNote = "追跡あり・比較的安価。500g〜2kg程度の小型に向く。";
  } else {
    method = "小型包装物（Small Packet）＋ 追跡オプション";
    methodNote = "軽量・低価格向け。紛失リスクを下げるなら追跡を付与。";
  }

  return {
    itemDescriptionEn: c.item,
    contentType: "Merchandise (sold goods)",
    declaredValueUsd: valueUsd,
    hsCode: c.hs,
    quantity: 1,
    method,
    methodNote,
  };
}
