import nodemailer from "nodemailer";

// メール送信ユーティリティ（つむまねの実装を流用）。
// 本プロジェクトでは既に GitHub Actions / SNSボットが Gmail SMTP を使っているため、
// 同じ認証情報（GMAIL_USERNAME / GMAIL_APP_PASSWORD = Googleアプリパスワード16桁）を再利用する。
// 互換のため SMTP_USER / SMTP_PASS というエイリアスでも読める。
//
// 必要な環境変数（Vercel に設定）:
//   GMAIL_USERNAME      送信元 Gmail アドレス
//   GMAIL_APP_PASSWORD  Google アプリパスワード（16桁・通常のログインPWではない）
//   REPORT_TO           （任意）レポート等の宛先。未設定なら運用者アドレスにフォールバック。

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
  return Boolean(SMTP_USER && SMTP_PASS);
}

/**
 * メール送信。認証情報が無い環境（ローカル等）では送信せずログのみ。
 * @param opts.from 表示名つき差出人（省略時は「輸出リサーチ」）
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
  if (!emailConfigured()) {
    console.warn("[email] SMTP credentials not set. Skipped sending:", subject);
    return;
  }
  await getTransporter().sendMail({
    from: from || `"輸出リサーチ" <${SMTP_USER}>`,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ""),
  });
}
