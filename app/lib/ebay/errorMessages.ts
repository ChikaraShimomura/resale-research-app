// eBay/出品まわりの生エラーを、ユーザー向けの「何が要因か」を端的に伝える日本語に変換する。
// 既知パターン → known:true＋具体的な要因。未知 → known:false＋「予期せぬエラーが発生しました。」。
// 呼び出し側は known=false の時だけ「開発者へ送信」ボタンを出し、生エラー(raw)は報告に同梱する。
//
// ⭐ 生エラー文字列には extractError(listing.ts) が付けた「(Name=Value, …)」と「#errorId」が残る。
//    ここからエラー番号と「問題のフィールド名」を取り出し、『何が・どの入力(○○と○○)が疑わしいか』を文に差し込む。

export interface FriendlyError {
  message: string; // ユーザーに見せる文（疑わしいフィールド名を差し込み済み）
  known: boolean; // 既知パターンに一致したか（false=予期せぬエラー）
  originField?: string[]; // 原因として疑われる入力フィールド（日本語ラベル）。UIで個別強調する用
}

// eBayのItem Specific/フィールド英名 → 日本語ラベル（出品モーダルの aspectLabel と揃える）。
const FIELD_LABELS: Record<string, string> = {
  character: "キャラクター",
  type: "種類",
  platform: "対応機種",
  brand: "ブランド",
  franchise: "シリーズ",
  genre: "ジャンル",
  "sub-genre": "サブジャンル",
  publisher: "発売元",
  "video game series": "ゲームシリーズ",
  "country/region of manufacture": "製造国",
  "country of manufacture": "製造国",
  color: "色",
  material: "素材",
  features: "特徴",
  model: "モデル",
  theme: "テーマ",
  size: "サイズ",
  mpn: "製品番号(MPN)",
  upc: "UPC",
  ean: "EAN",
  condition: "商品の状態",
  category: "カテゴリ",
  price: "価格",
  quantity: "数量",
};

function labelFor(raw: string): string {
  const key = raw.trim().toLowerCase();
  return FIELD_LABELS[key] ?? raw.trim();
}

// 生エラーから「問題のフィールド名」を抽出する。
//  ① "(Name=Value, …)" の Value（eBayのparameters＝#25002等で不足/不正なItem Specific名が入る）
//  ② "The item specific X is …" / "X is a required item specific" 等の本文パターン
function extractFields(raw: string): string[] {
  const found = new Set<string>();
  const paren = raw.match(/\(([^)]+)\)/);
  if (paren) {
    for (const part of paren[1].split(",")) {
      const v = part.includes("=") ? part.slice(part.indexOf("=") + 1) : part;
      const t = v.trim();
      // 数値のみ/空/長すぎる断片は除外（フィールド名は英字を含む短い語）。
      // 内部フィールド名(BEST_OFFER_AUTO_ACCEPT_AMOUNT 等の全大文字スネーク)や通貨コード(USD)は
      // ユーザー向けの「必須項目」ではないので拾わない＝小文字を含む人間語、または既知ラベルだけ採用。
      if (t && (/[a-z]/.test(t) || !!FIELD_LABELS[t.toLowerCase()]) && t.length <= 40 && !/^\d+$/.test(t)) found.add(t);
    }
  }
  const patterns = [
    /the item specific\s+([A-Za-z][\w /-]{1,38}?)\s+is\b/gi,
    /\b([A-Za-z][\w /-]{1,38}?)\s+is (?:a |an )?required item specific/gi,
    /required item specifics?\s*[:\-]\s*([A-Za-z][\w ,/-]{1,60})/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      for (const piece of m[1].split(",")) {
        const t = piece.trim();
        if (t && (/[a-z]/.test(t) || !!FIELD_LABELS[t.toLowerCase()]) && t.length <= 40) found.add(t);
      }
    }
  }
  return [...found];
}

// ["キャラクター","種類"] → 「キャラクター」と「種類」
function joinLabels(labels: string[]): string {
  return labels.map((l) => `「${l}」`).join("と");
}

export function friendlyEbayError(raw?: string | null, status?: number): FriendlyError {
  const s = (raw || "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => s.includes(k));
  // eBayがJSON body無しで失敗すると error は "HTTP 401" 等になる。status未渡しでもメッセージからコードを拾う。
  const code = status ?? (Number((s.match(/\bhttp\s*(\d{3})\b/) || [])[1]) || undefined);
  // eBayのエラー番号（#25002 等）。分類の最優先キーにする（曖昧な includes より確実）。
  const errorId = (raw || "").match(/#(\d{3,6})/)?.[1];
  // 疑わしいフィールド名（あれば文に差し込む）。
  const fieldLabels = [...new Set(extractFields(raw || "").map(labelFor))].slice(0, 3);
  const suspects = fieldLabels.length ? joinLabels(fieldLabels) : "";

  // eBayアカウントの出品上限（出品できる「件数」または「合計金額」の上限）に到達。
  // 新規/実績の浅い出品者にeBayが課す制限。レート制限(下)より先に判定する（"exceeded the number" 等の紛らわしい文面対策）。
  if (has(
    "selling-limits", "selling limit", "selling limits", "monthly selling limit",
    "amount you can list", "you can list up to", "total sales this month", "request to list more",
    "number of items you can list", "items you can list", "maximum number of items you",
    "exceed your selling", "exceeded your selling", "reached your selling", "you've reached your limit",
    "amount you can sell", "value you can sell",
    "21919303", "21916920", "21919508",
  ))
    return {
      message:
        "eBayアカウントの出品枠（今月に出せる件数・合計金額）の上限に達しています。この枠を広げるには、" +
        "まずeBayで取引実績を作ってアカウントを育てる必要があります（出品→販売→良い評価を積むほど、枠は自動で広がっていきます）。" +
        "いまは枠内に収まるよう件数や価格を抑え、安くて売れやすい商品から1件ずつ実績を作っていきましょう。",
      known: true,
    };

  if (code === 429 || has("rate limit", "too many", "call limit", "exceeded the number of calls"))
    return { message: "eBay側が混み合っています。少し時間をおいて、もう一度お試しください。", known: true };

  if (code === 401 || code === 403 || has("invalid_grant", "unauthorized", "not authorized", "access denied", "invalid token", "token expired"))
    return { message: "eBayとの連携が切れています。設定からeBayを再連携してください。", known: true };

  if ((code && code >= 500) || has("internal error", "service unavailable", "bad gateway", "gateway timeout"))
    return { message: "eBay側で一時的なエラーが発生しています。少し時間をおいて、もう一度お試しください。", known: true };

  // eBay在庫サービスの一時エラー（#25604 在庫の反映待ちで公開できず / #25001 内部エラー）。多くは時間をおけば解消。
  // 続く場合は発送元の住所(在庫ロケーション)が未登録の可能性。
  if (errorId === "25604" || errorId === "25001" || has("availability not found", "inventory service can not publish", "core inventory service"))
    return {
      message:
        "eBay側の在庫処理が一時的に詰まっています（数分おくと解消することが多いです）。少し待って再度お試しください。" +
        "何度も続く場合は、設定 → 発送元の住所 が正しく登録されているかご確認ください。",
      known: true,
    };

  // 出品テキストが英語でない（eBay規定）。香水/化粧品など日本語パッケージ品で頻発。
  if (has("not in english", "must be in english"))
    return {
      message: "商品名・説明・パッケージの文字が英語でないため、eBayの規定で出品できません。英語表記に直すか、別の商品でお試しください。",
      known: true,
    };

  // 配送ポリシーに、このeBayマーケットプレイスで非対応の発送先が含まれる（#216347 等）。
  if (errorId === "216347" || has("unsupported destinations", "destinations found in the request"))
    return {
      message: "配送ポリシーに、このeBayでは対応していない発送先が含まれています。設定 → 発送先 を見直して作り直してください。",
      known: true,
    };

  // ── ここから「出品内容」起因のエラー。errorId を最優先に分類し、疑わしいフィールド名を文に差し込む ──
  // ※ Best Offer(値下げ交渉)は廃止したので、自動承諾額関連のエラー分類は撤去（自社出品では発生しない）。

  // #25002 = 必須Item Specific 不足/不正（amiibo等で頻発：キャラクター・種類・対応機種 など）。
  if (errorId === "25002" || has("required item specific", "item specific", "missing required", "is a required")) {
    const detail = suspects
      ? `eBayの必須項目${suspects}が未入力、または内容が認められませんでした。`
      : "eBayの必須項目（キャラクター・種類・対応機種 など）が未入力、または内容が認められませんでした。";
    return {
      message: `${detail}出品画面の「詳細オプション」を開き、この項目を入力・修正して再度お試しください。`,
      known: true,
      originField: fieldLabels.length ? fieldLabels : undefined,
    };
  }

  // 発送元（在庫ロケーション）未設定。bare "location" は貪欲すぎるので具体語だけで判定する。
  if (has("merchantlocation", "merchant location", "inventory location", "ship-from", "ship from", "merchant_location"))
    return { message: "発送元の住所が未設定です。設定 → 発送元の住所 を登録してください。", known: true };

  if (has("fulfillment policy", "payment policy", "return policy", "business policy", "selling policy"))
    return { message: "配送・支払い・返品のポリシーが未設定です。初期設定（ポリシー作成）を完了してください。", known: true };

  // カテゴリ不正/未取得（#25022 等）。
  if (errorId === "25022" || has("category id", "categoryid", "invalid category", "leaf category", "category is")) {
    return { message: "商品カテゴリの自動判定に失敗したか、eBayで使えないカテゴリです。少し時間をおくか、別の商品名でお試しください。", known: true };
  }

  // 商品の状態（#25021 等）。
  if (errorId === "25021" || has("condition id", "conditionid", "invalid condition", "condition is not"))
    return { message: "商品の状態（新品／中古）の指定に問題があります。状態を選び直してください。", known: true };

  // 画像（#25710 等）。
  if (errorId === "25710" || has("picture", "image url", "eps", "imageurl", "photo"))
    return { message: "出品画像の取得・加工に失敗しました（画像が不正・読み込めない可能性）。別の写真に差し替えてお試しください。", known: true };

  if (has("duplicate", "already exists", "already exist"))
    return { message: "同じ商品がすでに出品中の可能性があります。マイページの「出品中」をご確認ください。", known: true };

  // 価格（具体語のみ。bare "price" は他文面に紛れるので語を絞る）。
  if (has("price is", "invalid price", "currency", "value must", "minimum price", "price must"))
    return { message: "価格の指定に問題があります。価格（USD）を確認してください。", known: true };

  // 必須項目（フィールド名が取れた場合は名指しする。取れない汎用ケースのフォールバック）。
  if (has("aspect", "required")) {
    const detail = suspects
      ? `必須項目${suspects}が不足しています。`
      : "必須項目（ブランドなど）が不足しています。";
    return { message: `${detail}入力欄を埋めて再度お試しください。`, known: true, originField: fieldLabels.length ? fieldLabels : undefined };
  }

  if (has("timeout", "network", "fetch failed", "econn", "socket"))
    return { message: "通信が不安定です。少し時間をおいて、もう一度お試しください。", known: true };

  // 未知：フィールド名が取れていれば、それだけでも示して「丸投げ」を避ける。
  if (suspects)
    return { message: `出品でエラーが発生しました。${suspects}の内容が原因の可能性があります。ご確認のうえ、解決しない場合は開発者へご報告ください。`, known: false, originField: fieldLabels };

  return { message: "予期せぬエラーが発生しました。", known: false };
}
