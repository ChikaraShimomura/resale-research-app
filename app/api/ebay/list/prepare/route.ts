import { getActorId } from "../../../../lib/auth/actor";
import { kv } from "@vercel/kv";
import { getProductById } from "../../../../lib/ebay/productStore";
import { aiRefineDescription, keepsKeyClauses } from "../../../../lib/ebay/refineDescription";
import { getValidAccessToken } from "../../../../lib/ebay/tokens";
import { getAppAccessToken } from "../../../../lib/ebay/oauth";
import {
  getCategorySuggestion,
  getRequiredAspects,
  listFulfillmentPolicies,
  getComparableMarket,
  USD_JPY,
  RequiredAspect,
} from "../../../../lib/ebay/listing";
import { landedCost, recommendShippingTier, pickShippingPolicyId } from "../../../../lib/ebay/landedCost";
import { decodeHtmlEntities } from "../../../../lib/htmlEntities.mjs";
import { fetchHardoffGallery } from "../../../../lib/usedGallery";
import { hasPerm, getTeamMode } from "../../../../lib/team";

// 利益計算と同じ係数（refresh.mjs と一致）。損益分岐の値付けに使う。
const EBAY_FEE_RATE = 0.1325;
const EBAY_FEE_FIXED_JPY = 47;

// 「eBay出品画面」の確認用データを返す（読み取りのみ・eBayへの書き込みなし）。
// 楽天画像・タイトル・推奨USD価格・自動判定カテゴリ・必須Item Specifics を返す。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Item Specifics の初期値。Brand はジャンル別に別途整える。
// 必須も推奨(任意)も「選択肢が多すぎる」ため、無難な既定を自動で入れておく（ユーザーは画面で変更可）。
// 推奨項目を埋めると検索に出やすくなる(SEO)＋空のドロップダウンを潰せるので、選ぶ手間を減らせる。
function defaultAspect(a: RequiredAspect, productText = ""): string {
  if (/brand/i.test(a.name)) return "Unbranded";
  // 型番(MPN)不明時の公式表記。必須MPNの未入力(#25002)ブロックを防ぐ。
  if (/^mpn$|manufacturer part/i.test(a.name)) return "Does Not Apply";
  // 製造国は日本仕入れ前提。候補にJapanがあればそれを、自由入力でもJapanを既定に。
  if (/country.*manufacture|country of origin/i.test(a.name)) {
    const jp = a.values.find((v) => /japan/i.test(v));
    if (jp) return jp;
    if (a.values.length === 0) return "Japan";
  }
  if (a.values.length > 0) {
    // ★商品テキスト(ブランド/型番/名前)に一致する候補を優先する。
    //   これが無いと例えば Platform に先頭候補「3DO」が入る等、無関係な値が機械的に入って誤Item Specificsになる。
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const tn = norm(productText);
    if (tn) {
      const hit = a.values.find((v) => {
        const vn = norm(v);
        if (vn.length < 3) return false;
        // 候補語が商品テキストに含まれる、or 候補の主要語(4文字以上)が含まれる。
        return tn.includes(vn) || vn.split(" ").some((w) => w.length >= 4 && tn.includes(w));
      });
      if (hit) return hit;
    }
    // 一致が無ければ先頭候補（必須=未入力#25002回避）。eBay候補は概ね定番順なので先頭が無難。
    return a.values[0];
  }
  return "";
}

// ジャンル → eBayカテゴリ判定を正す検索ヒント。型番だけだと「Video Games」等に誤分類されるため、
// カテゴリ候補クエリにジャンル語を足して正しいカテゴリ(コンソール/カメラ/時計…)へ寄せる。
function categoryHint(cat: string | undefined): string {
  switch (cat) {
    case "ゲーム機": return "video game console";
    case "カメラ": return "camera";
    case "腕時計": return "wristwatch";
    case "オーディオ": return "audio";
    case "楽器": return "musical instrument";
    default: return "";
  }
}
// ジャンルの英語語（タイトル補強用。例: ゲーム機→Console）。
function genreWord(cat: string | undefined): string {
  switch (cat) {
    case "ゲーム機": return "Console";
    case "カメラ": return "Camera";
    case "腕時計": return "Watch";
    case "オーディオ": return "Audio";
    case "楽器": return "Instrument";
    default: return "";
  }
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

// 中古サイト(ハードオフ/2nd ST)の状態ランク → eBay condition。N/S/A=極上〜美品→USED_EXCELLENT、B/C/D→USED_GOOD。
// モーダルの状態プルダウン(NEW/USED_EXCELLENT/USED_GOOD)に収まる値だけ返す。判定不能は null。
function rankToEbayCondition(raw?: string): string | null {
  if (!raw) return null;
  const r = String(raw).toUpperCase();
  if (/新品|未使用/.test(r)) return "USED_EXCELLENT";
  const m = r.match(/(?:中古)?\s*([NSABCD])\b/);
  const code = m ? m[1] : "";
  if (code === "N" || code === "S" || code === "A") return "USED_EXCELLENT";
  if (code === "B" || code === "C" || code === "D") return "USED_GOOD";
  return null;
}

// 英語の説明文（編集可）。購入者がよく気にする点をQ&Aで手厚く、かつトラブル回避の文言を網羅する。
// プレーンテキストで返し（編集しやすい）、公開時に listing.ts が改行→HTMLに変換する。
// ジャンル別「中古品として明示すべき注意」。説明文と実物の差によるクレーム(Not as described)を防ぐ核心。
function usedConditionNotes(category?: string): string {
  switch (category) {
    case "腕時計":
      return "Watch notes: the battery may be depleted and need replacement; timekeeping accuracy is NOT guaranteed; water resistance is NOT guaranteed (gaskets age) so please avoid water exposure. The band/case may show scratches and wear; sizing is as shown in the photos.";
    case "オーディオ":
      return "Audio notes: tested and working unless otherwise stated; cosmetic wear such as scratches and dust is normal for used audio. IMPORTANT: this unit is designed for Japan 100V and a Japanese plug — a voltage step-up/step-down transformer and plug adapter may be required in your country. On vintage units, internal parts (capacitors, belts, etc.) may age and could need future servicing.";
    case "カメラ":
      return "Camera/lens notes: optics may have minor dust, haze, or small marks — please check the photos closely. Mechanical functions are checked as far as possible, but this is a used item sold as-is. For film cameras, light seals may need replacement; battery/film are not included unless shown.";
    case "ゲーム機":
      return "Game hardware notes: tested to power on and function unless otherwise stated. This is the Japanese (NTSC-J) version and may be region-locked; it is made for Japan 100V with a Japanese plug, so please confirm region/voltage/plug compatibility before buying. Any internal save battery in retro hardware may be depleted.";
    case "楽器":
      return "Instrument/gear notes: tested and working unless otherwise stated; cosmetic wear is normal. Any included power adapter is Japan-spec (100V) — please confirm compatibility. Sold as-is.";
    default:
      return "";
  }
}

function buildDescription(enTitle: string, condition: string, category?: string, junk = false): string {
  const isNew = condition === "NEW";
  const condLine = isNew
    ? "Brand new and unused (factory sealed unless the photos show otherwise)."
    : "Pre-owned. This is a used item and may show signs of use (scratches, wear, etc.) appropriate for its age. It is sold AS-IS in the exact condition shown in the photos.";

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
  // 中古品のジャンル別注意（クレーム回避の徹底）。
  if (!isNew) {
    const note = usedConditionNotes(category);
    if (note) L.push(note);
  }
  // ジャンク品は「動作未確認/不動・返品不可・部品取り」を明確に警告。
  if (junk) {
    L.push("");
    L.push(
      "⚠️ IMPORTANT — SOLD AS JUNK / FOR PARTS OR NOT WORKING: this item is untested or has known problems and may NOT function at all. Please buy only if you are comfortable with parts or repair. No returns are accepted for junk items. Review all photos carefully."
    );
  }
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
  const viewer = await getActorId();
  if (!viewer) return Response.json({ ok: false, connected: false });

  const { productId, onBehalfOf } = (await req.json().catch(() => ({}))) as { productId?: string; onBehalfOf?: string };
  if (!productId) return Response.json({ ok: false, error: "商品が指定されていません。" }, { status: 400 });

  // チーム：出品権限があれば共有在庫を準備。eBay(ポリシー/カテゴリ/トークン)は方式で決まる＝共有はオーナー、個別はメンバー本人。
  let actor = viewer;
  const owner = (onBehalfOf || "").trim();
  if (owner && owner !== viewer) {
    if (!(await hasPerm(owner, viewer, "list"))) return Response.json({ ok: false, error: "出品権限がありません。" }, { status: 403 });
    actor = (await getTeamMode(owner)) === "shared" ? owner : viewer;
  }
  const token = await getValidAccessToken(actor);
  if (!token) return Response.json({ ok: false, connected: false });

  const product = await getProductById(productId);
  if (!product) return Response.json({ ok: false, error: "商品が見つかりませんでした。" }, { status: 404 });

  // 既定の表示価格＝eBay最安ベース(realAvgPrice)。売り方「相場/はやく」は中央値を基準にするため medianUsd も返す。
  const priceUsd = Math.max(1, Math.round((product.realAvgPrice / USD_JPY) * 100) / 100).toFixed(2);
  const medianUsd =
    product.realMedianPrice && product.realMedianPrice > 0
      ? Math.max(1, Math.round((product.realMedianPrice / USD_JPY) * 100) / 100).toFixed(2)
      : priceUsd;

  // タイトルは英語(coreKeyword=マッチしたeBay商品の英語タイトル)を既定にする。
  // coreKeyword は eBay の alt 属性由来で &#34; 等のHTMLエンティティが残るので、出品文字列にする前に復号する。
  // ★中古はタイトルが「ブランド+型番」だけで貧弱になりがち→ジャンル語(Console/Camera…)と "Japan" を重複しない範囲で補強。
  //   日本仕入れの正規品＝"Japan" は検索・信頼の両面で効くキーワード。80字以内に収める（ユーザーは画面で編集可）。
  const baseTitle = decodeHtmlEntities(product.coreKeyword || product.title);
  const gw = genreWord(product.category);
  const titleParts = [baseTitle];
  if (gw && !new RegExp(`\\b${gw}\\b`, "i").test(baseTitle)) titleParts.push(gw);
  if (!/japan/i.test(baseTitle)) titleParts.push("Japan");
  const enTitle = titleParts.join(" ").slice(0, 80).trim();
  // ★中古有在庫モデル：仕入れ元が中古サイト(ハードオフ/2nd ST)なら必ず中古。状態ランク(usedCondition)を段階反映。
  //   ジャンクは USED_ACCEPTABLE＋説明文で「for parts/not working」を明示。旧モデル(楽天新品)だけタイトル判定。
  const srcSite = product.source?.site as string | undefined;
  const usedCond = (product as { usedCondition?: string }).usedCondition;
  const isJunkItem = /JUNK|ジャンク/i.test(usedCond || "");
  const condition =
    srcSite === "hardoff" || srcSite === "2ndstreet"
      ? isJunkItem
        ? "USED_ACCEPTABLE"
        : rankToEbayCondition(usedCond) || "USED_GOOD"
      : detectCondition(product.title);
  const description = buildDescription(enTitle, condition, product.category, isJunkItem);

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
  // カテゴリ判定用クエリ＝商品識別(ブランド+型番)＋ジャンルヒント。型番だけだと「Video Games」等へ誤分類するため、
  // "video game console"等を足して正しいカテゴリ(コンソール/カメラ/時計…)へ寄せる＝誤Item Specifics(例:Platform=3DO)を断つ。
  const categoryQuery = `${decodeHtmlEntities(product.coreKeyword || product.title)} ${categoryHint(product.category)}`.trim();
  const [cat, shipping, market] = await Promise.all([
    getCategorySuggestion(taxoToken, categoryQuery, condition),
    listFulfillmentPolicies(token),
    getComparableMarket(taxoToken, product.coreKeyword || enTitle), // 同等品の現在の最安USD＋競合数（1回のBrowseで両方）
  ]);
  const lowestComparable = market.lowestUsd;
  const competitionCount = market.activeCount; // eBay現在出品総数（競合の目安・概算。null=取得不可）

  // 損益分岐(USD)：このeBay価格を下回ると赤字になる下限。「最安で出す」時もここは割らない。
  // profit=0 ⇔ ebayJpy*(1-fee) - 固定手数料 = 現金原価(楽天価格+国内送料)。
  // ※ ポイントは利益に含めない方針なので原価から引かない＝ポイント頼みで赤字ラインを下げない（安全側）。
  const effBuyJpy = product.source.price + (product.source.shippingJpy ?? 0);
  // 損益分岐に出品者の実負担を織り込む。送料そのものは購入者負担なので引かない。
  // subtractJpy = 「送料にかかるeBay手数料」＋「$100超の米国関税(前払い・立替)」。高額品ほど floor が上がり赤字を防ぐ。
  const landed = landedCost(product.category, Number(priceUsd));
  const floorJpy = Math.max(1, (effBuyJpy + EBAY_FEE_FIXED_JPY + landed.subtractJpy) / (1 - EBAY_FEE_RATE));
  const floorUsd = (Math.round((floorJpy / USD_JPY) * 100) / 100).toFixed(2);
  const lowestUsd =
    lowestComparable && lowestComparable > 0 ? (Math.round(lowestComparable * 100) / 100).toFixed(2) : null;

  // Item Specifics の既定を「商品テキスト一致」で埋めるための材料（ブランド/型番/名前）。
  const productText = `${product.coreKeyword ?? ""} ${product.title ?? ""} ${(product as { name?: string }).name ?? ""}`.trim();
  let requiredAspects: { name: string; values: string[]; free: boolean; required: boolean; value: string }[] = [];
  if (cat?.categoryId) {
    const aspects = await getRequiredAspects(taxoToken, cat.categoryTreeId, cat.categoryId);
    requiredAspects = aspects.map((a) => {
      if (/brand/i.test(a.name)) {
        // ブランドはジャンル別に3択へ絞り、タイトルから分かれば正しいブランドを既定選択にする。
        const b = brandFor(product.category, `${product.coreKeyword ?? ""} ${product.title ?? ""}`);
        return { ...a, values: b.options, free: false, value: b.value };
      }
      return { ...a, value: defaultAspect(a, productText) }; // 商品テキスト一致で誤った先頭候補(例:Platform=3DO)を回避
    });
  }
  // 製造国＝日本仕入れ前提。カテゴリが必須/推奨で返さなかった時も「Made in Japan」を既定項目として必ず出す
  // （信頼/検索のシグナル＋返品低減。日本製でない品は出品前にこの欄を編集で上書き可）。既出時は注入しない。
  if (!requiredAspects.some((a) => /country.*manufacture|country of origin/i.test(a.name))) {
    requiredAspects.push({
      name: "Country/Region of Manufacture",
      values: ["Japan", "China", "United States", "Unknown"],
      free: true,
      required: false,
      value: "Japan",
    });
  }

  // 出品画像の候補：自宅ワーカー(galleryWorker)が取得した楽天ギャラリー(ref_gallery)＋APIの代表画像。
  // ユーザーは出品画面でこの中から「出品に使う写真」をチェックで選ぶ。未取得ならAPIの画像だけ。
  let refImages: string[] = [];
  try {
    const ref = await kv.get<{ status?: string; urls?: string[] }>(`ref_gallery:${productId}`);
    if (ref?.status === "done" && Array.isArray(ref.urls)) refImages = ref.urls.slice(0, 24);
  } catch {
    /* noop */
  }
  // 中古(ハードオフ)はAkamai無し＝ここ(Vercel)から詳細ページの全画像(JSON-LD・1280px)を取りに行ける。
  // ref_gallery 未取得なら取得して候補に充当＋ref_galleryに焼く（次回以降は再取得不要）。非ハードオフURLは[]で素通り。
  if (!refImages.length && product.source?.url) {
    try {
      const g = await fetchHardoffGallery(product.source.url);
      if (g.length) {
        refImages = g;
        try { await kv.set(`ref_gallery:${productId}`, { status: "done", urls: g }, { ex: 30 * 24 * 3600 }); } catch { /* noop */ }
      }
    } catch { /* noop */ }
  }
  const productImages = (product.images?.length ? product.images : [product.imageUrl]).filter(Boolean);

  return Response.json(
    {
      ok: true,
      product: {
        id: product.id,
        jaTitle: decodeHtmlEntities(product.title),
        imageUrl: product.imageUrl,
        rakutenPrice: product.source.price,
        ebayAvgJpy: product.realAvgPrice,
      },
      refImages,      // 楽天ギャラリー(自宅ワーカー取得・出品/撮影の候補)
      productImages,  // 楽天APIの代表画像(常に最低1枚)
      title: enTitle,
      description: finalDescription,
      priceUsd,  // 既定の表示価格＝eBay最安ベース
      medianUsd, // 中央値USD（売り方「相場/はやく」の基準）
      lowestUsd, // 同等品の現在の最安USD（null=取得できず）
      competitionCount, // eBay現在出品総数＝競合の目安（概算・null=取得できず）。出品判断の参考に表示。
      floorUsd,  // 損益分岐USD（これ未満は赤字・国際送料/関税の目安を織り込み済み）
      effBuyJpy: Math.round(effBuyJpy), // 実質仕入れ原価。モーダルで「重さ(任意)」入力時に損益分岐を再計算するのに使う
      landed: {  // 損益分岐に織り込んだ着地コストの内訳（モーダルで内訳と$100超の前払い注意を出す）
        weightG: landed.weightG,
        shippingJpy: landed.shippingJpy,
        shippingMethod: landed.shippingMethod,
        dutyJpy: landed.dutyJpy,
        needsDutyPrepay: landed.needsDutyPrepay,
      },
      condition,
      category: cat
        ? { categoryId: cat.categoryId, categoryName: cat.categoryName, categoryTreeId: cat.categoryTreeId }
        : null,
      requiredAspects,
      shipping,
      // 送料ポリシーは「推定重量＋高額(EMS必須)」で選ぶ（ジャンルでなく実態ベース）。重さ入力時はモーダル側で再選択。
      recommendedShippingId: pickShippingPolicyId(shipping, recommendShippingTier(landed.weightG, Number(priceUsd))),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
