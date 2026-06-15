import { cookies } from "next/headers";
import { kv } from "@vercel/kv";
import { kvReadOnly } from "../../../../lib/kv";
import { aiRefineDescription, keepsKeyClauses } from "../../../../lib/ebay/refineDescription";
import { ProfitProduct } from "../../../../lib/profitFilter";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getAppAccessToken } from "../../../../lib/ebay/oauth";
import {
  getCategorySuggestion,
  getRequiredAspects,
  listFulfillmentPolicies,
  getLowestComparableUsd,
  USD_JPY,
  RequiredAspect,
} from "../../../../lib/ebay/listing";

// 利益計算と同じ係数（refresh.mjs と一致）。損益分岐の値付けに使う。
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED_JPY = 47;

// 「eBay出品画面」の確認用データを返す（読み取りのみ・eBayへの書き込みなし）。
// 楽天画像・タイトル・推奨USD価格・自動判定カテゴリ・必須Item Specifics を返す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getProduct(id: string): Promise<ProfitProduct | null> {
  try {
    const products = await kvReadOnly.get<ProfitProduct[]>("profitable_products");
    return products?.find((p) => p.id === id) ?? null;
  } catch {
    return null;
  }
}

// 必須Item Specifics の初期値（選択式は先頭候補、それ以外は空）。Brand はジャンル別に別途整える。
function defaultAspect(a: RequiredAspect): string {
  if (/brand/i.test(a.name)) return "Unbranded";
  // 候補があれば（自由入力タイプでも）先頭を既定に。必須Item Specific の未入力(#25002)を防ぐ。
  if (a.values.length > 0) return a.values[0];
  return "";
}

// ブランド候補をジャンル別に最大3つへ絞り、タイトルから分かれば正しいブランドを既定にする。
// eBayの大量候補は初心者に多すぎるため、把握しているジャンル情報で「無難な3択＋既定」に整える。
const BRAND_BY_GENRE: Record<string, { options: string[]; def: string }> = {
  ガンプラ: { options: ["Bandai", "Unbranded"], def: "Bandai" },
  LEGO: { options: ["LEGO", "Unbranded"], def: "LEGO" },
  フィギュア: { options: ["Good Smile Company", "Bandai", "Unbranded"], def: "Unbranded" },
  腕時計: { options: ["Casio", "Seiko", "Unbranded"], def: "Unbranded" },
  コスメ: { options: ["Shiseido", "Kao", "Unbranded"], def: "Unbranded" },
  トレカ: { options: ["Pokémon", "Bandai", "Unbranded"], def: "Unbranded" },
  ゲーム: { options: ["Nintendo", "Sony", "Unbranded"], def: "Unbranded" },
  ゲーム機: { options: ["Nintendo", "Sony", "Unbranded"], def: "Unbranded" },
  カメラ: { options: ["Canon", "Sony", "Unbranded"], def: "Unbranded" },
  おもちゃ: { options: ["Takara Tomy", "Bandai", "Unbranded"], def: "Unbranded" },
};

function brandFor(genre: string, titleText: string): { options: string[]; value: string } {
  const base = BRAND_BY_GENRE[genre] ?? { options: ["Unbranded"], def: "Unbranded" };
  const t = (titleText || "").toLowerCase();
  const hit = (re: RegExp, brand: string): string | null => (re.test(t) ? brand : null);
  // タイトル(英/和)から分かるブランドを優先＝既定がより正確に。
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
  if (detected) {
    const options = [detected, ...base.options.filter((o) => o !== detected)].slice(0, 3);
    return { options, value: detected };
  }
  return { options: base.options, value: base.def };
}

// 状態の自動判定：大半は新品。楽天タイトルに「中古」等があるときだけ中古に。
function detectCondition(jaTitle: string): string {
  if (/中古|ユーズド|used|ジャンク/i.test(jaTitle)) {
    if (/非常に良い|美品|ほぼ新品|新品同様|like ?new/i.test(jaTitle)) return "USED_EXCELLENT";
    return "USED_GOOD";
  }
  return "NEW";
}

// ジャンル(=荷物の大きさの目安)→ eBay配送ポリシーのサイズ区分。小さい物に大サイズ送料を当てない。
const SHIP_TIER_BY_GENRE: Record<string, "small" | "medium" | "large"> = {
  トレカ: "small", コスメ: "small", 腕時計: "small", フィギュア: "small",
  ゲーム: "small", おもちゃ: "small", ガンプラ: "medium", LEGO: "large",
};
// ジャンルに最適な送料ポリシーのIDを選ぶ（ポリシー名の small/medium/large で判定）。
// 該当サイズが無ければ medium→先頭にフォールバック。ユーザーは画面で変更可。
function recommendShippingId(
  shipping: { fulfillmentPolicyId: string; name: string }[],
  genre?: string
): string | undefined {
  if (!shipping?.length) return undefined;
  const tier = (genre && SHIP_TIER_BY_GENRE[genre]) || "medium";
  const re = tier === "small" ? /small/i : tier === "large" ? /large/i : /medium/i;
  const hit =
    shipping.find((s) => re.test(s.name)) ??
    shipping.find((s) => /medium/i.test(s.name)) ??
    shipping[0];
  return hit?.fulfillmentPolicyId;
}

// 英語の説明文（編集可）。購入者がよく気にする点をQ&Aで手厚く、かつトラブル回避の文言を網羅する。
// プレーンテキストで返し（編集しやすい）、公開時に listing.ts が改行→HTMLに変換する。
function buildDescription(enTitle: string, condition: string, category?: string): string {
  const isNew = condition === "NEW";
  const condLine = isNew
    ? "Brand new and unused (factory sealed unless the photos show otherwise)."
    : "Pre-owned and in good overall condition. Please check the photos for the exact condition.";

  const L: string[] = [];
  L.push(enTitle);
  L.push("");
  L.push(
    "Thank you for viewing my listing! This item is located in Japan and ships directly from Japan with tracking. Please read the details below before purchasing."
  );
  L.push("");
  L.push("【 Condition 】");
  L.push(condLine);
  L.push("The photos are part of the description, so please review them carefully.");
  L.push("");
  L.push("【 Frequently Asked Questions 】");
  L.push("");
  L.push("Q. Is this item authentic?");
  L.push("A. Yes. It is 100% genuine and sourced in Japan. I never sell counterfeit items.");
  L.push("");
  L.push("Q. Where does it ship from, and how long does delivery take?");
  L.push(
    "A. It ships from Japan with a tracking number. Delivery usually takes about 1 to 3 weeks depending on your country and local customs processing."
  );
  L.push("");
  L.push("Q. Will I be charged customs or import duties?");
  L.push(
    "A. I try to choose items that usually do not trigger customs duties. However, if any import duties, taxes, or customs fees ARE charged by your country, they are the buyer's responsibility and are NOT included in the item price or shipping. Please check your country's import rules before buying."
  );
  L.push("");
  L.push("Q. How will it be packaged?");
  L.push("A. It will be packed carefully and securely to protect it during international shipping.");
  L.push("");
  L.push("Q. Do you provide tracking?");
  L.push("A. Yes. Every order ships with a tracking number so you can follow your parcel.");
  L.push("");
  L.push("Q. What is your return policy?");
  L.push(
    "A. Returns are accepted in line with the return policy on this listing and eBay's Money Back Guarantee. If anything is wrong, please message me first and I will do my best to make it right."
  );
  L.push("");
  L.push("Q. Is there a warranty for defects?");
  L.push(
    "A. I do not offer a separate warranty or compensation. Products sold in Japan very rarely have initial defects, so problems are uncommon. In the rare case of a genuine manufacturer defect, please contact the manufacturer's support directly. For anything about your order, please message me first."
  );

  // ジャンル別の注意（トラブル回避）。
  if (category === "ゲーム" || category === "ゲーム機" || category === "カメラ") {
    L.push("");
    L.push("Q. Will it work in my country?");
    L.push(
      "A. This is the Japanese version. Games/consoles may be region-locked, and electronics are made for Japanese voltage (100V) and a Japanese plug. Please confirm region/voltage/plug compatibility before buying."
    );
  }
  if (category === "コスメ") {
    L.push("");
    L.push("Q. Is the cosmetic item new and unused?");
    L.push(
      "A. Yes, unless otherwise noted. Please note that some countries restrict importing cosmetics, so check your local rules before buying."
    );
  }
  if (category === "トレカ") {
    L.push("");
    L.push("Q. How are the cards packaged?");
    L.push(
      "A. Cards are protected with a sleeve and rigid packaging, then shipped with tracking. Please see the photos for the exact card and condition."
    );
  }
  if (category === "フィギュア" || category === "ガンプラ" || category === "LEGO" || category === "おもちゃ") {
    L.push("");
    L.push("Q. What about the box condition?");
    L.push(
      "A. For collectible items, the outer box may have minor shelf wear from storage or transport, but the contents are unaffected. Please check the photos." +
        (category === "ガンプラ" ? " Note: model kits are sold unbuilt and require assembly." : "")
    );
  }
  if (category === "腕時計") {
    L.push("");
    L.push("Q. Anything to know about the watch?");
    L.push(
      "A. The battery may need replacement over time, and water resistance is not guaranteed unless stated. Please see the photos and feel free to ask before buying."
    );
  }

  L.push("");
  L.push("【 Important Notes 】");
  L.push("- Please make sure your shipping address is complete and correct before ordering.");
  L.push("- Feel free to message me with any questions before purchasing. I'm happy to help.");
  L.push("- If there is any problem with your order, please contact me before opening a case. I respond quickly and will resolve it.");
  L.push("");
  L.push("Thank you, and happy shopping!");
  return L.join("\n");
}

export async function POST(req: Request) {
  const actor = (await cookies()).get("rr_did")?.value;
  if (!actor) return Response.json({ ok: false, connected: false });
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const { productId } = (await req.json().catch(() => ({}))) as { productId?: string };
  if (!productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  const product = await getProduct(productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  // 既定の表示価格＝eBay最安ベース(realAvgPrice)。売り方「相場/はやく」は中央値を基準にするため medianUsd も返す。
  const priceUsd = Math.max(1, Math.round((product.realAvgPrice / USD_JPY) * 100) / 100).toFixed(2);
  const medianUsd =
    product.realMedianPrice && product.realMedianPrice > 0
      ? Math.max(1, Math.round((product.realMedianPrice / USD_JPY) * 100) / 100).toFixed(2)
      : priceUsd;

  // タイトルは英語(coreKeyword=マッチしたeBay商品の英語タイトル)を既定にする。
  const enTitle = (product.coreKeyword || product.title).slice(0, 80);
  const condition = detectCondition(product.title);
  const description = buildDescription(enTitle, condition, product.category);

  // AIチェック：作り込んだ定型文を Claude(Haiku) で自然化。必須の方針/トラブル回避文が残っている時だけ採用。
  // 商品×状態でキャッシュ（無料枠の節約＋高速化）。失敗・欠落時は定型をそのまま使う（安全側）。
  let finalDescription = description;
  try {
    const descKey = `ebay_desc:v1:${productId}:${condition}`;
    const cached = await kv.get<string>(descKey);
    if (typeof cached === "string" && cached.length > 150) {
      finalDescription = cached;
    } else {
      const refined = await aiRefineDescription(description);
      if (refined && keepsKeyClauses(refined)) {
        finalDescription = refined;
        await kv.set(descKey, refined, { ex: 30 * 24 * 3600 });
      } else {
        // 定型にフォールバック。短めTTLでキャッシュし、次回AI再試行の余地を残す。
        await kv.set(descKey, description, { ex: 7 * 24 * 3600 });
      }
    }
  } catch {
    /* キャッシュ/AI失敗時は素の定型文を使う */
  }

  // カテゴリ + 必須Item Specifics（Taxonomy）。アプリトークン優先、不可ならユーザートークン。
  // 送料サイズ（配送ポリシー）一覧も取得。
  const taxoToken = (await getAppAccessToken()) || token;
  const [cat, shipping, lowestComparable] = await Promise.all([
    getCategorySuggestion(taxoToken, enTitle, condition),
    listFulfillmentPolicies(token),
    getLowestComparableUsd(taxoToken, product.coreKeyword || enTitle), // 同等品の現在の最安USD（最速出品用）
  ]);

  // 損益分岐(USD)：このeBay価格を下回ると赤字になる下限。「最安で出す」時もここは割らない。
  // profit=0 ⇔ ebayJpy*(1-fee) - 固定手数料 = 仕入れ実質原価(楽天価格+国内送料-ポイント)。
  const effBuyJpy =
    product.source.price + (product.source.shippingJpy ?? 0) - (product.source.pointAmount ?? 0);
  const floorJpy = Math.max(1, (effBuyJpy + EBAY_FEE_FIXED_JPY) / (1 - EBAY_FEE_RATE));
  const floorUsd = (Math.round((floorJpy / USD_JPY) * 100) / 100).toFixed(2);
  const lowestUsd =
    lowestComparable && lowestComparable > 0 ? (Math.round(lowestComparable * 100) / 100).toFixed(2) : null;

  let requiredAspects: { name: string; values: string[]; free: boolean; value: string }[] = [];
  if (cat?.categoryId) {
    const aspects = await getRequiredAspects(taxoToken, cat.categoryTreeId, cat.categoryId);
    requiredAspects = aspects.map((a) => {
      if (/brand/i.test(a.name)) {
        // ブランドはジャンル別に3択へ絞り、タイトルから分かれば正しいブランドを既定選択にする。
        const b = brandFor(product.category, `${product.coreKeyword ?? ""} ${product.title ?? ""}`);
        return { ...a, values: b.options, free: false, value: b.value };
      }
      return { ...a, value: defaultAspect(a) };
    });
  }

  return Response.json(
    {
      ok: true,
      product: {
        id: product.id,
        jaTitle: product.title,
        imageUrl: product.imageUrl,
        rakutenPrice: product.source.price,
        ebayAvgJpy: product.realAvgPrice,
      },
      title: enTitle,
      description: finalDescription,
      priceUsd,  // 既定の表示価格＝eBay最安ベース
      medianUsd, // 中央値USD（売り方「相場/はやく」の基準）
      lowestUsd, // 同等品の現在の最安USD（null=取得できず）
      floorUsd,  // 損益分岐USD（これ未満は赤字）
      condition,
      category: cat
        ? { categoryId: cat.categoryId, categoryName: cat.categoryName, categoryTreeId: cat.categoryTreeId }
        : null,
      requiredAspects,
      shipping,
      recommendedShippingId: recommendShippingId(shipping, product.category), // ジャンル(サイズ)に最適な送料ポリシー
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
