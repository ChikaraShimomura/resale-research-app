import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendTwoFactorEmail(email: string, code: string) {
  await resend.emails.send({
    from: "輸出で副業しようよ <noreply@yourdomain.com>",
    to: email,
    subject: "【輸出で副業しようよ】ログイン認証コード",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#4f46e5;margin-bottom:8px;">輸出で副業しようよ</h2>
        <p style="color:#374151;">以下の認証コードを入力してください。</p>
        <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <span style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#111827;">${code}</span>
        </div>
        <p style="color:#6b7280;font-size:14px;">このコードは10分間有効です。身に覚えのない場合は無視してください。</p>
      </div>
    `,
  });
}
