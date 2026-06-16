import nodemailer from "nodemailer";

// メール送信ユーティリティ。プロバイダは Resend を優先し、未設定なら従来の Gmail SMTP にフォールバックする
// （= RESEND_API_KEY を入れた瞬間に Resend へ切替・入れるまでは挙動不変＝非破壊）。
//
// 一本化の最終形: Resend（自社ドメイン yushutsu-fukugyo.com から送信＝認証メールの到達性が段違い）。
// 移行が確認できたら nodemailer / Gmail パスは撤去する。
//
// 必要な環境変数（Vercel に設定）:
//   RESEND_API_KEY      Resend の API キー（あれば最優先で使用）
//   MAIL_FROM           Resend の差出人（認証済みドメイン必須。既定: 輸出ラボ <noreply@yushutsu-fukugyo.com>）
//   GMAIL_USERNAME      フォールバック: 送信元 Gmail アドレス
//   GMAIL_APP_PASSWORD  フォールバック: Google アプリパスワード（16桁）
//   REPORT_TO           （任意）レポート等の宛先。未設定なら運用者アドレス。

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.MAIL_FROM || "輸出ラボ <noreply@yushutsu-fukugyo.com>";

const SMTP_USER = process.env.GMAIL_USERNAME || process.env.SMTP_USER || "";
const SMTP_PASS = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || "";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10);

// レポート等の既定の宛先（運用者）。Vercel/Actions で既出のアドレスと揃える。
export const REPORT_TO = process.env.REPORT_TO || "chikara0323@gmail.com";

// nodemailer のトランスポーターは使い回す（毎回生成しない）。
let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465=SSL / 587=STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export function emailConfigured(): boolean {
  return Boolean(RESEND_API_KEY) || Boolean(SMTP_USER && SMTP_PASS);
}

const toText = (html: string, text?: string) => text || html.replace(/<[^>]+>/g, "");

// Resend HTTP API で送信（SDK不要・既存のfetch方針に合わせる）。
async function sendViaResend(opts: { to: string; subject: string; html: string; text?: string; from?: string }): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from || RESEND_FROM, // 認証済みドメインの差出人であること
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: toText(opts.html, opts.text),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend send failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * メール送信。Resend優先→Gmailフォールバック。どちらも未設定なら送信せずログのみ。
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
  if (RESEND_API_KEY) {
    await sendViaResend({ to, subject, html, text, from });
    return;
  }
  if (SMTP_USER && SMTP_PASS) {
    await getTransporter().sendMail({
      from: from || `"輸出リサーチ" <${SMTP_USER}>`,
      to,
      subject,
      html,
      text: toText(html, text),
    });
    return;
  }
  console.warn("[email] no provider configured (RESEND_API_KEY / GMAIL_*). Skipped sending:", subject);
}
