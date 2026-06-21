// Stripe を「SDK非依存」で薄く叩くサーバー専用ヘルパー。
// 公式 stripe パッケージを足さず fetch で REST を叩く＝依存ゼロ・env未設定なら完全に休眠（既存挙動を壊さない）。
// 使うのは Checkout Session 作成 / Customer Portal 作成 / Webhook 署名検証 の3つだけ。
import { createHmac, timingSafeEqual } from "crypto";

const API_BASE = "https://api.stripe.com/v1";
const SECRET = process.env.STRIPE_SECRET_KEY; // sk_live_... / sk_test_...
const API_VERSION = "2024-06-20"; // 固定しておくとAPIの破壊的変更の影響を受けにくい

// Stripe決済が有効か（秘密鍵が入っているか）。未設定なら課金APIは 503「準備中」を返す。
export function stripeConfigured(): boolean {
  return !!SECRET;
}

// Stripe REST を form-urlencoded で叩く。params は a[b]=c 形式へ自前で平坦化。
// 失敗時は { error } を含む JSON を throw せず返すので、呼び出し側で扱う。
export async function stripeRequest(
  path: string,
  params: Record<string, unknown> = {},
  method: "POST" | "GET" = "POST",
): Promise<Record<string, unknown>> {
  if (!SECRET) throw new Error("stripe_not_configured");
  const body = encodeForm(params);
  const url = method === "GET" && body ? `${API_BASE}${path}?${body}` : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Stripe-Version": API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json?.error as { message?: string } | undefined)?.message || `stripe_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ネストしたparamsを Stripe の a[b][c]=v 形式に平坦化（配列は a[0][price] 等）。
function encodeForm(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") {
      parts.push(encodeForm(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

// Webhook 署名の検証（公式SDKの constructEvent 相当を最小実装）。
// header `stripe-signature` = "t=<unix>,v1=<hex>"。signed_payload = "<t>.<rawBody>" の HMAC-SHA256 を突合。
// 5分(=tolerance)以上ズレた timestamp は拒否（リプレイ対策）。検証OKなら parse済みイベントを返す。
export function verifyStripeEvent(
  rawBody: string,
  sigHeader: string | null,
  secret: string | undefined,
  toleranceSec = 300,
): Record<string, unknown> | null {
  if (!sigHeader || !secret) return null;
  let t = "";
  const v1: string[] = [];
  for (const part of sigHeader.split(",")) {
    const [k, val] = part.split("=");
    if (k === "t") t = val;
    else if (k === "v1") v1.push(val);
  }
  if (!t || v1.length === 0) return null;

  // timestamp の許容範囲（new Date 直呼びは環境制約があるため Date.now を使う）。
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > toleranceSec) return null;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const expBuf = Buffer.from(expected, "utf8");
  const ok = v1.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf8");
    return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  });
  if (!ok) return null;

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
