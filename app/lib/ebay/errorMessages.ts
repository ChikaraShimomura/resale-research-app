// eBay/出品まわりの生エラーを、ユーザー向けの「何が要因か」を端的に伝える日本語に変換する。
// 既知パターン → known:true＋具体的な要因。未知 → known:false＋「予期せぬエラーが発生しました。」。
// 呼び出し側は known=false の時だけ「開発者へ送信」ボタンを出し、生エラー(raw)は報告に同梱する。

export interface FriendlyError {
  message: string; // ユーザーに見せる文
  known: boolean; // 既知パターンに一致したか（false=予期せぬエラー）
}

export function friendlyEbayError(raw?: string | null, status?: number): FriendlyError {
  const s = (raw || "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => s.includes(k));
  // eBayがJSON body無しで失敗すると error は "HTTP 401" 等になる。status未渡しでもメッセージからコードを拾う。
  const code = status ?? (Number((s.match(/\bhttp\s*(\d{3})\b/) || [])[1]) || undefined);

  if (code === 429 || has("rate limit", "too many", "call limit", "exceeded the number"))
    return { message: "eBay側が混み合っています。少し時間をおいて、もう一度お試しください。", known: true };

  if (code === 401 || code === 403 || has("invalid_grant", "unauthorized", "not authorized", "access denied", "invalid token", "token expired"))
    return { message: "eBayとの連携が切れています。設定からeBayを再連携してください。", known: true };

  if ((code && code >= 500) || has("internal error", "service unavailable", "bad gateway", "gateway timeout"))
    return { message: "eBay側で一時的なエラーが発生しています。少し時間をおいて、もう一度お試しください。", known: true };

  if (has("merchantlocation", "merchant location", "inventory location", "ship-from", "ship from", "location"))
    return { message: "発送元の住所が未設定です。設定 → 発送元の住所 を登録してください。", known: true };

  if (has("fulfillment policy", "payment policy", "return policy", "business policy", "selling policy", "policy"))
    return { message: "配送・支払い・返品のポリシーが未設定です。初期設定（ポリシー作成）を完了してください。", known: true };

  if (has("category"))
    return { message: "選んだカテゴリがeBayで使えません。別のカテゴリでお試しください。", known: true };

  if (has("aspect", "item specific", "required", "missing required"))
    return { message: "必須項目（ブランドなど）が不足しています。入力欄を埋めて再度お試しください。", known: true };

  if (has("price", "currency", "value must", "minimum"))
    return { message: "価格の指定に問題があります。価格（USD）を確認してください。", known: true };

  if (has("image", "picture", "photo", "eps"))
    return { message: "画像の取得・加工に失敗しました。別の写真に差し替えてお試しください。", known: true };

  if (has("duplicate", "already exists", "sku"))
    return { message: "同じ商品がすでに出品中の可能性があります。マイページの「出品中」をご確認ください。", known: true };

  if (has("condition"))
    return { message: "商品の状態（新品／中古）の指定に問題があります。状態を選び直してください。", known: true };

  if (has("timeout", "network", "fetch failed", "econn", "socket"))
    return { message: "通信が不安定です。少し時間をおいて、もう一度お試しください。", known: true };

  return { message: "予期せぬエラーが発生しました。", known: false };
}
