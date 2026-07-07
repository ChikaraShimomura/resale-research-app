// 既存eBay出品を「返品最小化テンプレ」に改訂するための決定論ロジック（サーバー専用・AI不使用）。
// すべて商品データの差し込みだけで生成する＝AI呼び出しゼロ＝連打しても課金は発生しない。
// 返品(INAD)/未着(INR)クレームの主因（状態の食い違い・写真不一致・互換性・関税の不意打ち・到着遅れ）を
// 説明文/タイトル/Item Specifics で先回りして潰すことを狙う。
import { ProfitProduct } from "../profitFilter";

// テンプレの版。改良したら上げる。同版で最適化済みの出品は no-op（route が版で判定）＝版を上げた時だけ再実行できる。
export const OPTIMIZE_VERSION = "2"; // 2: 関税文言を「Import duties & taxes」独立見出し＋中立で安全な表現に更新（既存最適化品も再最適化で反映）

// タイトル/和文からブランドを推定する（prepare の brandFor と同じ語彙）。
// 確信できる時だけブランド名を返し、不明は "Unbranded"（＝既存のItem Specificsを尊重し上書きしない）。
function detectBrand(genre: string, text: string): string {
  const t = (text || "").toLowerCase();
  const hit = (re: RegExp, brand: string): string | null => (re.test(t) ? brand : null);
  const detected =
    hit(/pok[eé]mon|ポケモン/, "Pokémon") ||
    hit(/one ?piece|ワンピース|dragon ?ball|ドラゴンボール|gundam|ガンダム|ガンプラ|bandai|バンダイ/, "Bandai") ||
    hit(/yu-?gi-?oh|遊戯王|konami|コナミ/, "Konami") ||
    hit(/lego|レゴ/, "LEGO") ||
    hit(/nintendo|任天堂|amiibo|アミーボ|switch/, "Nintendo") ||
    hit(/playstation|プレイステーション|プレステ|\bsony\b|ソニー/, "Sony") ||
    hit(/seiko|セイコー/, "Seiko") ||
    hit(/casio|カシオ|g-?shock|gショック/, "Casio") ||
    hit(/citizen|シチズン/, "Citizen") ||
    hit(/shiseido|資生堂/, "Shiseido") ||
    hit(/花王/, "Kao") ||
    hit(/good ?smile|グッドスマイル|nendoroid|ねんどろいど/, "Good Smile Company") ||
    hit(/canon|キヤノン|キャノン/, "Canon") ||
    hit(/nikon|ニコン/, "Nikon") ||
    hit(/takara ?tomy|タカラトミー|トミカ|プラレール/, "Takara Tomy");
  if (detected) return detected;
  // ジャンルで確実なものだけ既定にする（不明は Unbranded のまま＝既存を壊さない）。
  const byGenre: Record<string, string> = { ガンプラ: "Bandai", LEGO: "LEGO" };
  return byGenre[genre] ?? "Unbranded";
}

// 状態の自動判定（prepare の detectCondition と同じ）。大半は新品。和文タイトルに中古語があれば中古に。
function detectCondition(jaTitle: string): string {
  if (/中古|ユーズド|used|ジャンク/i.test(jaTitle)) {
    if (/非常に良い|美品|ほぼ新品|新品同様|like ?new/i.test(jaTitle)) return "USED_EXCELLENT";
    return "USED_GOOD";
  }
  return "NEW";
}

// 最適化タイトル：Brand（確信時のみ）＋ coreKeyword（一致したeBay英語タイトル）＋ "Japan"。80字以内。
// "Japan" は信頼ワードとして残し、80字超は coreKeyword 側を縮める。
export function buildOptimizedTitle(product: ProfitProduct): string {
  const core = (product.coreKeyword || product.title || "").replace(/\s+/g, " ").trim();
  const brand = detectBrand(product.category, `${product.coreKeyword ?? ""} ${product.title ?? ""}`);
  const useBrand = !!brand && brand !== "Unbranded" && !core.toLowerCase().includes(brand.toLowerCase());
  const prefix = useBrand ? `${brand} ` : "";
  const suffix = /\bjapan\b/i.test(core) ? "" : " Japan";

  let title = `${prefix}${core}${suffix}`.replace(/\s+/g, " ").trim();
  if (title.length > 80) {
    const room = Math.max(0, 80 - prefix.length - suffix.length);
    const trimmedCore = core.slice(0, room).trim();
    title = `${prefix}${trimmedCore}${suffix}`.replace(/\s+/g, " ").trim();
  }
  return title.slice(0, 80);
}

// 最適化Item Specifics：製造国=Japan（仕入れ元が日本＝確信できる信頼/返品低減シグナル）。
// ブランドは確信できる時だけ付ける（不明な時に既存のブランドを上書きしないため省く）。
// 返り値は { 名前: 値 }。route 側で既存の必須項目にマージする（提供した項目だけ上書き）。
export function buildOptimizedAspects(product: ProfitProduct, category?: string): Record<string, string> {
  const aspects: Record<string, string> = { "Country/Region of Manufacture": "Japan" };
  const brand = detectBrand(category ?? product.category, `${product.coreKeyword ?? ""} ${product.title ?? ""}`);
  if (brand && brand !== "Unbranded") aspects["Brand"] = brand;
  return aspects;
}

// 最適化説明文（英語・プレーンテキスト）。公開時は listing.ts の descriptionToHtml で改行(■見出し含む)→HTMLに変換される。
// 構成は輸出ラボ③で確定した「全ジャンル返品最小化テンプレ」＝共通ベース＋guessCategory連動のジャンル別ブロック。
// 返品(特に"説明と違う"INAD)を、揉める前に期待値を全部書いて潰すのが狙い。
// テンプレ内の [ ] 可変部は、確実に分かるもの(状態New/Used・ブランド)だけ差し込み、
// 不確実なもの(同梱物・寸法・光学状態)は値を捏造せず「写真をご確認ください」に寄せる（嘘をつかない＝INADを増やさない）。
export function buildOptimizedDescription(product: ProfitProduct): string {
  const enTitle = (product.coreKeyword || product.title || "").slice(0, 80);
  const category = product.category;
  const isNew = detectCondition(product.title || "") === "NEW";

  const L: string[] = [];
  if (enTitle) {
    L.push(enTitle);
    L.push("");
  }

  // ── 共通ベース（全ジャンル先頭） ──
  L.push("■ Authenticity");
  L.push("100% authentic, sourced directly within Japan. We never sell replicas or counterfeits.");
  L.push("");
  L.push("■ Shipping");
  L.push(
    "Ships from Japan with tracking, carefully and securely packaged. Estimated delivery is about 1–3 weeks depending on your country and customs."
  );
  L.push("");
  L.push("■ Import duties & taxes");
  L.push(
    "Import duties, taxes, and customs fees (if any) are the buyer's responsibility and are not included in the item price or shipping cost. Please check your country's import regulations before purchasing."
  );
  L.push("");
  L.push("■ Please note");
  L.push(
    "Colors may look slightly different due to screen settings. Product labels and instructions may be in Japanese. Questions? Please message us BEFORE buying — we're happy to help. If there is ever any issue with your order, please contact us FIRST and we'll resolve it quickly."
  );
  L.push("");

  // ── ジャンル別ブロック（guessCategory / product.category 連動） ──
  for (const line of genreBlock(category, isNew)) L.push(line);

  L.push("");
  L.push("Thank you for visiting our store!");
  return L.join("\n");
}

// 輸出ラボ③のジャンル別ブロックを、状態(New/Used)で枝分かれさせて返す。
// 一番効くのは「ゲーム＝リージョン明記」「カメラ＝不具合の正直開示」。
function genreBlock(category: string, isNew: boolean): string[] {
  switch (category) {
    case "トレカ":
      return [
        "■ Condition",
        "Please judge the condition from the actual photos (ungraded; no professional grade unless stated).",
        "",
        "■ Details",
        "Japanese edition. Shipped in a sleeve and top loader / protective packaging. Please see the photos for the exact item.",
      ];
    case "ゲーム":
    case "ゲーム機":
      return [
        "■ Region",
        "Japanese version (NTSC-J). It may NOT work on non-Japanese consoles or regions — please check compatibility before purchase.",
        "",
        "■ Language",
        "Menus and text are in Japanese.",
        "",
        "■ Condition",
        isNew
          ? "Brand new and sealed. Please see the photos for exactly what is included."
          : "Used — tested and working where shown; please see the photos for the exact condition and for exactly what is included.",
        ...(category === "ゲーム機"
          ? ["", "■ Power", "Designed for Japan (100V); a plug or voltage adapter may be required."]
          : []),
      ];
    case "フィギュア":
      return [
        "■ Condition",
        isNew
          ? "Brand new, factory sealed. 100% authentic (no bootlegs)."
          : "Opened — displayed only; please see the photos. 100% authentic (no bootlegs).",
        "",
        "■ Note",
        "The outer box may show minor shelf wear from storage. Packed securely to avoid transit damage.",
      ];
    case "ガンプラ":
    case "LEGO":
      return [
        "■ Condition",
        isNew
          ? "Brand new, unbuilt, and factory sealed unless otherwise noted. All parts and instructions are included (sealed)."
          : "Please see the photos for the exact condition and contents.",
        "",
        "■ Note",
        "The box may show minor shelf wear. Instructions are in Japanese.",
      ];
    case "腕時計":
      return [
        "■ Authenticity",
        "100% genuine. Box and papers: please see the photos.",
        "",
        "■ Condition",
        isNew ? "Brand new." : "Used — please see the photos for the exact condition.",
        "",
        "■ Note",
        "For used or vintage pieces, timekeeping accuracy is not guaranteed and a battery or service may be needed.",
      ];
    case "カメラ":
      return [
        "■ Functionality & condition",
        "Please check the photos carefully and judge functionality and condition from them. For the optics, please note any fungus, haze, dust, or scratches shown in the photos.",
        "",
        "■ Included",
        "Please see the photos for exactly what is included (body / lens / cap / battery, etc.).",
        "",
        "■ Note",
        "Electronic models are for Japan voltage (100V); an adapter may be needed. Vintage items are sold as collectibles.",
      ];
    case "おもちゃ":
    case "アニメグッズ":
      return [
        "■ Condition",
        isNew
          ? "New, sealed. 100% authentic official merchandise."
          : "Used — please see the photos. 100% authentic official merchandise.",
        "",
        "■ Note",
        "The package or box may show minor wear. Packed carefully.",
      ];
    case "コスメ":
      // 返品の可否は返品ポリシー(設定トグル)が握る。返品不可運用と矛盾しないよう、説明文に返品の語は入れない（案A）。
      return [
        "■ Condition",
        isNew
          ? "Brand new and factory-sealed unless stated."
          : "Please see the photos for the exact condition.",
        "",
        "■ Note",
        "Ingredients and usage are printed in Japanese.",
      ];
    default:
      // 本・CD・その他 Books / Media / Other（汎用）。
      return [
        "■ Condition",
        "Please see the photos for the exact condition.",
        "",
        "■ Details",
        "Please see the title and photos for size, material, and what's included. Text or content may be in Japanese.",
      ];
  }
}
