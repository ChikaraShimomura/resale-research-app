// ========== eBay出品用バイリンガル説明文ジェネレーター ==========

const BRAND_JP_TO_EN: Record<string, string> = {
  "任天堂": "Nintendo", "ニンテンドー": "Nintendo",
  "ソニー": "Sony", "プレイステーション": "PlayStation",
  "セガ": "Sega", "カプコン": "Capcom", "コナミ": "Konami",
  "バンダイ": "Bandai", "バンダイナムコ": "Bandai Namco",
  "スクウェアエニックス": "Square Enix", "スクエニ": "Square Enix",
  "タカラトミー": "Takara Tomy", "トミカ": "Tomica",
  "レゴ": "LEGO",
  "コトブキヤ": "Kotobukiya", "グッドスマイルカンパニー": "Good Smile Company",
  "グッドスマイル": "Good Smile", "マックスファクトリー": "Max Factory",
  "アルター": "Alter", "メガハウス": "MegaHouse",
  "フリーイング": "FREEing", "カイヨドウ": "Kaiyodo",
  "ポケモン": "Pokemon", "ポケットモンスター": "Pokemon",
  "遊戯王": "Yu-Gi-Oh", "デュエルマスターズ": "Duel Masters",
  "ドラゴンボール": "Dragon Ball", "ナルト": "Naruto",
  "進撃の巨人": "Attack on Titan", "鬼滅の刃": "Demon Slayer",
  "呪術廻戦": "Jujutsu Kaisen", "ワンピース": "One Piece",
  "エヴァンゲリオン": "Evangelion", "ガンダム": "Gundam",
  "初音ミク": "Hatsune Miku",
  "キヤノン": "Canon", "キャノン": "Canon",
  "ニコン": "Nikon", "フジフイルム": "Fujifilm",
  "オリンパス": "Olympus", "パナソニック": "Panasonic",
};

const CONDITION_KEYWORDS_NEW = ["新品", "未開封", "未使用", "シールド", "sealed"];
const CONDITION_KEYWORDS_USED = ["中古", "使用済み", "難あり", "used", "junk"];

// カテゴリ推定
type Category =
  | "figure"
  | "lego"
  | "gunpla"
  | "card"
  | "game"
  | "camera"
  | "toy"
  | "anime"
  | "other";

function detectCategory(title: string): Category {
  const t = title.toLowerCase();
  if (/フィギュア|figure|figma|nendoroid|ねんどろいど|プライズ/.test(t)) return "figure";
  if (/lego|レゴ/.test(t)) return "lego";
  if (/ガンプラ|gunpla|mg|rg|hg|pg|re\/100|sd|1\/144|1\/100|ガンダム|zaku/.test(t)) return "gunpla";
  if (/ポケモンカード|pokemon card|遊戯王|yu-gi-oh|トレカ|tcg|card game|デュエルマスターズ/.test(t)) return "card";
  if (/switch|ps5|ps4|xbox|ゲーム|game|ソフト|software/.test(t)) return "game";
  if (/カメラ|camera|レンズ|lens|一眼|ミラーレス/.test(t)) return "camera";
  if (/ガンダム|anime|アニメ|manga|マンガ|figure|グッズ|goods/.test(t)) return "anime";
  if (/おもちゃ|玩具|toy|トミカ|プラモデル/.test(t)) return "toy";
  return "other";
}

// ブランド名を英語に翻訳
function translateTitle(title: string): string {
  let result = title;
  for (const [jp, en] of Object.entries(BRAND_JP_TO_EN)) {
    result = result.replace(new RegExp(jp, "g"), en);
  }
  return result;
}

// 全角→半角
function normalize(text: string): string {
  return text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

// コンディション判定
function detectCondition(title: string): { en: string; jp: string } {
  const t = title.toLowerCase();
  if (CONDITION_KEYWORDS_NEW.some(k => t.includes(k))) {
    return { en: "Brand New, Sealed / Unopened", jp: "新品未開封" };
  }
  if (CONDITION_KEYWORDS_USED.some(k => t.includes(k))) {
    return { en: "Used (See photos for details)", jp: "中古品（写真をご確認ください）" };
  }
  return { en: "Brand New", jp: "新品" };
}

// カテゴリ別の売り文句
function getCategoryPitch(category: Category): { en: string; jp: string } {
  switch (category) {
    case "figure":
      return {
        en: "Authentic Japanese collectible figure. Popular among collectors worldwide.",
        jp: "日本国内で購入した正規品フィギュアです。コレクターの方に人気のアイテムです。",
      };
    case "lego":
      return {
        en: "Official LEGO set purchased in Japan. Great for collectors and builders.",
        jp: "日本正規品のLEGOセットです。コレクターやビルダーの方におすすめです。",
      };
    case "gunpla":
      return {
        en: "Official Bandai Gunpla kit made in Japan. Highly detailed and perfect for Gundam fans.",
        jp: "バンダイ正規品のガンプラです。精巧なディテールでガンダムファンの方に最適です。",
      };
    case "card":
      return {
        en: "Authentic Japanese trading card(s). Sourced directly from Japan.",
        jp: "日本国内で購入した正規品カードです。",
      };
    case "game":
      return {
        en: "Japanese version game. Please confirm region compatibility before purchasing.",
        jp: "日本版のゲームソフトです。ご購入前にリージョン互換性をご確認ください。",
      };
    case "camera":
      return {
        en: "Japanese market camera/lens. Excellent quality and reliability.",
        jp: "日本市場向けカメラ・レンズです。高品質で信頼性の高いアイテムです。",
      };
    case "anime":
      return {
        en: "Official Japanese anime merchandise. A must-have for fans.",
        jp: "日本の正規ライセンスアニメグッズです。ファンの方への贈り物にも最適です。",
      };
    case "toy":
      return {
        en: "Authentic Japanese toy/collectible. Hard to find outside Japan.",
        jp: "日本でしか手に入りにくいおもちゃ・コレクターズアイテムです。",
      };
    default:
      return {
        en: "Authentic Japanese product shipped directly from Japan.",
        jp: "日本から直接発送する正規品です。",
      };
  }
}

export interface DescriptionOptions {
  title: string;
  price: number;          // 楽天仕入れ価格（参考用・表示しない）
  ebayAvgPrice?: number;  // eBay相場価格
  imageUrl?: string;
  market?: string;        // EBAY_US / EBAY_GB / EBAY_AU
}

export function generateEbayDescription(opts: DescriptionOptions): string {
  const { title, ebayAvgPrice, market } = opts;
  const isUK = market === "EBAY_GB";
  const isAU = market === "EBAY_AU";
  const norm = normalize(title);
  const translated = translateTitle(norm);
  const condition = detectCondition(norm);
  const category = detectCategory(norm.toLowerCase());
  const pitch = getCategoryPitch(category);

  // タイトル英語化（カタカナ・記号除去して英数字主体に）
  const engTitle = translated
    .replace(/【[^】]*】/g, "")
    .replace(/[^\x00-\x7F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const lines: string[] = [];

  // ───────── ヘッダー ─────────
  lines.push(`✦ ${engTitle || title}`);
  lines.push("");

  // ───────── 商品情報（英語） ─────────
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("  ITEM DETAILS");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`• Condition  : ${condition.en}`);
  lines.push(`• Origin     : Japan (Ships directly from Japan)`);
  lines.push(`• Language   : Japanese Edition`);
  if (ebayAvgPrice) {
    lines.push(`• Est. Value : ¥${ebayAvgPrice.toLocaleString()} JPY (based on recent eBay sales)`);
  }
  lines.push("");
  lines.push(pitch.en);
  lines.push("");

  // ───────── 商品情報（日本語） ─────────
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("  商品情報 / 日本語説明");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`【商品名】${title}`);
  lines.push(`【コンディション】${condition.jp}`);
  lines.push(`【発送元】日本 / Ships from Japan`);
  lines.push("");
  lines.push(pitch.jp);
  lines.push("");

  // ───────── 発送情報 ─────────
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("  SHIPPING / 発送について");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (isUK) {
    lines.push("• Ships from Japan via Japan Post (International Tracked / EMS)");
    lines.push("• Tracking number provided");
    lines.push("• Usually dispatched within 1–3 business days after payment");
    lines.push("• Combined postage available — please request an invoice");
  } else if (isAU) {
    lines.push("• Ships from Japan via Japan Post (EMS / International Parcel)");
    lines.push("• Tracking number provided");
    lines.push("• Usually dispatched within 1–3 business days after payment");
    lines.push("• Combined shipping available / まとめ買い送料割引あり");
  } else {
    lines.push("• Ships from Japan via Japan Post (EMS / e-Packet / SAL)");
    lines.push("• Tracking number provided / 追跡番号あり");
    lines.push("• Usually dispatched within 1–3 business days after payment");
    lines.push("  （入金確認後、通常1〜3営業日以内に発送）");
    lines.push("• Combined shipping available / まとめ買い送料割引あり");
  }
  lines.push("");

  // ───────── 注意事項 ─────────
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("  IMPORTANT NOTES / ご注意");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("• Import duties/taxes are the buyer's responsibility.");
  lines.push("  （輸入関税・税金はお客様のご負担となります）");
  lines.push("• Please check your country's import regulations before purchasing.");
  lines.push("  （ご購入前に輸入規制をご確認ください）");
  lines.push("• Item is authentic and sourced from Japanese retail stores.");
  lines.push("  （日本の正規小売店より仕入れた正規品です）");
  lines.push("");

  // ───────── フッター ─────────
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("Thank you for visiting! Feel free to ask any questions.");
  lines.push("ご覧いただきありがとうございます。お気軽にご質問ください。");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}
