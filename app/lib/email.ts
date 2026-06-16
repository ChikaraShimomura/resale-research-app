// メール送信ユーティリティ。Resend（自社ドメイン yushutsu-fukugyo.com から送信）に一本化。
// 自社ドメイン＋SPF/DKIM/DMARC認証済みのため、認証メール・レポート・アラートの到達性が高い。
// RESEND_API_KEY 未設定の環境（ローカル等）では送信せずログのみ。
//
// 必要な環境変数（Vercel に設定）:
//   RESEND_API_KEY   Resend の API キー（これが無いと送信しない）
//   MAIL_FROM        差出人（認証済みドメイン必須。既定: 輸出ラボ <noreply@yushutsu-fukugyo.com>）
//   REPORT_TO        （任意）レポート等の宛先。未設定なら運用者アドレス。

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.MAIL_FROM || "輸出ラボ <noreply@yushutsu-fukugyo.com>";

// レポート等の既定の宛先（運用者）。
export const REPORT_TO = process.env.REPORT_TO || "chikara0323@gmail.com";

export function emailConfigured(): boolean {
  return Boolean(RESEND_API_KEY);
}

const toText = (html: string, text?: string) => text || html.replace(/<[^>]+>/g, "");

/**
 * メール送信（Resend HTTP API）。RESEND_API_KEY が無ければ送信せずログのみ（非破壊）。
 * @param opts.from 認証済みドメインの差出人（省略時は MAIL_FROM 既定）
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  from,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set. Skipped sending:", subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from || RESEND_FROM, // 認証済みドメインの差出人であること
      to,
      subject,
      html,
      text: toText(html, text),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend send failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}
