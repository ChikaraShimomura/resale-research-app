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

  // eBayアカウントの出品上限（出品できる「件数」または「合計金額」の上限）に到達。
  // 新規/実績の浅い出品者にeBayが課す制限。レート制限(下)より先に判定する（"exceeded the number" 等の紛らわしい文面対策）。
  // ※実エラー実測(2026-06-19, 8件)＝「This listing would cause you to exceed the amount you can list. You can list up to $X more
  //   in total sales this month ... selling-limits?id=4107」。"selling-limits"(URL・ハイフン)/"amount you can list"/"you can list up to"
  //   /"total sales this month"/"request to list more" が確実な手掛かり。スペース有りの "selling limit" だけだと取りこぼす。
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
        "eBayアカウントの出品枠（今月に出せる件数・合計金額）の上限に達しています。新規アカウントは最初この枠が小さく、" +
        "売れて評価が付くと自動で広がっていきます（実績がつけばSeller Hubでの引き上げ申請も通りやすくなります）。" +
        "まずは枠内に収まるよう、件数を減らすか価格の安い商品から出品して、最初の1件を売って枠を育てるのがおすすめです。",
      known: true,
    };

  if (code === 429 || has("rate limit", "too many", "call limit", "exceeded the number of calls"))
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
