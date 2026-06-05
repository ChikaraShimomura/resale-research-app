import { Product } from "../types";

export const mockProducts: Product[] = [
  // 楽天
  {
    id: "1",
    title: "ポケモンカードゲーム スカーレット&バイオレット 強化拡張パック 夜明けの凱歌 BOX",
    titleEn: "Pokemon Card Game Scarlet & Violet Booster Box Dawn Fanfare Japanese",
    descriptionEn: "Brand new sealed Pokemon Card Game Scarlet & Violet expansion pack booster box. Japanese version. Factory sealed. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/dc2626/white?text=Pokemon",
    category: "トレーディングカード",
    source: { site: "rakuten", siteName: "楽天", price: 6600, url: "https://www.rakuten.co.jp/", pointRate: 10, pointAmount: 660 },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 9800, soldCount: 143, profit: 3136, profitRate: 52, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 14200, soldCount: 38, profit: 6318, profitRate: 106, affiliateUrl: "https://www.ebay.com/" },
    ],
  },
  // 駿河屋
  {
    id: "2",
    title: "ドラゴンクエストIV 導かれし者たち (ファミコン)",
    titleEn: "Dragon Quest IV Famicom NES Japanese Version Retro Game Cart",
    descriptionEn: "Dragon Quest IV (Dragon Warrior IV) for the Famicom (NES). Japanese version. Retro classic RPG. Cartridge only. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/4f46e5/white?text=DQ4",
    category: "レトロゲーム",
    source: { site: "surugaya", siteName: "駿河屋", price: 2800, url: "https://www.surugaya.co.jp/search?query=%E3%83%89%E3%83%A9%E3%82%B4%E3%83%B3%E3%82%AF%E3%82%A8%E3%82%B9%E3%83%8804" },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 4200, soldCount: 67, profit: 980, profitRate: 35, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 13500, soldCount: 23, profit: 9061, profitRate: 323, affiliateUrl: "https://www.ebay.com/" },
    ],
    soldOut: true,
  },
  // 楽天
  {
    id: "3",
    title: "資生堂 アネッサ パーフェクトUV スキンケアミルク 60mL SPF50+",
    titleEn: "Shiseido ANESSA Perfect UV Skincare Milk SPF50+ PA++++ 60mL Japanese Sunscreen",
    descriptionEn: "Shiseido ANESSA Perfect UV Skincare Milk SPF50+ PA++++. 60mL. Popular Japanese sunscreen. Water and sweat resistant. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/f59e0b/white?text=Anessa",
    category: "コスメ・美容",
    source: { site: "rakuten", siteName: "楽天", price: 2200, url: "https://www.rakuten.co.jp/", pointRate: 20, pointAmount: 440 },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 1900, soldCount: 312, profit: -160, profitRate: -9, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 5800, soldCount: 67, profit: 3272, profitRate: 185, affiliateUrl: "https://www.ebay.com/" },
    ],
  },
  // ブックオフ
  {
    id: "4",
    title: "Canon AE-1 フィルムカメラ ボディ（動作確認済）",
    titleEn: "Canon AE-1 35mm Film Camera Body Tested Working Japan Vintage",
    descriptionEn: "Canon AE-1 35mm SLR film camera body. Fully tested and working. Good condition. Classic vintage camera. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/0891b2/white?text=AE-1",
    category: "フィルムカメラ",
    source: { site: "bookoff", siteName: "ブックオフ", price: 4500, url: "https://www.bookoffonline.co.jp/files/search_list.php?search_word=Canon+AE-1" },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 7500, soldCount: 94, profit: 2250, profitRate: 50, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 14250, soldCount: 87, profit: 7611, profitRate: 169, affiliateUrl: "https://www.ebay.com/" },
    ],
  },
  // 楽天
  {
    id: "5",
    title: "LEGO テクニック ランボルギーニ ウルス ST-X 42115",
    titleEn: "LEGO Technic Lamborghini Urus ST-X 42115 Brand New Sealed",
    descriptionEn: "LEGO Technic Lamborghini Urus ST-X set #42115. Brand new and factory sealed. Japanese retail version. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/f97316/white?text=LEGO",
    category: "LEGO",
    source: { site: "rakuten", siteName: "楽天", price: 32000, url: "https://www.rakuten.co.jp/", pointRate: 12, pointAmount: 3840 },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 34000, soldCount: 28, profit: 2690, profitRate: 9, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 55000, soldCount: 41, profit: 20540, profitRate: 72, affiliateUrl: "https://www.ebay.com/" },
    ],
  },
  // 駿河屋
  {
    id: "6",
    title: "ガンプラ MG 1/100 νガンダム Ver.Ka（未組立）",
    titleEn: "Gundam MG 1/100 Nu Gundam Ver.Ka Model Kit Unassembled Japan",
    descriptionEn: "Master Grade 1/100 scale Nu Gundam Ver.Ka plastic model kit. Unassembled, all parts included. Original Japanese version. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/1d4ed8/white?text=Gundam",
    category: "ガンプラ",
    source: { site: "surugaya", siteName: "駿河屋", price: 4200, url: "https://www.surugaya.co.jp/search?query=%E3%83%8C%E3%82%AC%E3%83%B3%E3%83%80%E3%83%A0+MG" },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 6800, soldCount: 52, profit: 1920, profitRate: 46, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 10500, soldCount: 22, profit: 4940, profitRate: 118, affiliateUrl: "https://www.ebay.com/" },
    ],
  },
  // 楽天
  {
    id: "7",
    title: "Nintendo Switch 有機ELモデル ホワイト",
    titleEn: "Nintendo Switch OLED Model White Brand New Sealed Japan",
    descriptionEn: "Nintendo Switch OLED Model in White. Brand new factory sealed. Japanese version (region free for most games). Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/e11d48/white?text=Switch",
    category: "ゲーム機",
    source: { site: "rakuten", siteName: "楽天", price: 37980, url: "https://www.rakuten.co.jp/", pointRate: 8, pointAmount: 3038 },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 36000, soldCount: 521, profit: -542, profitRate: -1, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 52000, soldCount: 94, profit: 10166, profitRate: 29, affiliateUrl: "https://www.ebay.com/" },
    ],
  },
  // ブックオフ
  {
    id: "8",
    title: "リーバイス 501 ヴィンテージ デニムジャケット 80s USA製",
    titleEn: "Levi's 501 Vintage Denim Jacket 80s Made in USA Rare",
    descriptionEn: "Vintage Levi's denim jacket from the 1980s. Made in USA. Good condition for its age. Rare find. Ships from Japan.",
    imageUrl: "https://placehold.co/200x200/854d0e/white?text=Levi's",
    category: "ヴィンテージ古着",
    source: { site: "bookoff", siteName: "ブックオフ", price: 3200, url: "https://www.bookoffonline.co.jp/files/search_list.php?search_word=%E3%83%AA%E3%83%BC%E3%83%90%E3%82%A4%E3%82%B9" },
    profits: [
      { platform: "mercari", platformName: "メルカリ", avgPrice: 8500, soldCount: 38, profit: 4620, profitRate: 144, affiliateUrl: "https://mercari.com/" },
      { platform: "ebay", platformName: "eBay", avgPrice: 11250, soldCount: 45, profit: 6959, profitRate: 217, affiliateUrl: "https://www.ebay.com/" },
    ],
    isNew: true,
  },
];
