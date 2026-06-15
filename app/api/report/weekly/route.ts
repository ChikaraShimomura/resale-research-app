import { buildWeeklyReport } from "../../../lib/funnelReport";
import { sendEmail, REPORT_TO, emailConfigured } from "../../../lib/email";

// 行動ログの週次ファネルをメール送信する Vercel Cron エンドポイント。
// vercel.json の crons から毎週月曜 09:00 JST（00:00 UTC）に叩かれ、「直近7日(JST)」を集計する。
// 手動確認用に ?date=YYYY-MM-DD で集計窓の最終日、?secret= で認証も可能。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  // 認証：Vercel Cron は CRON_SECRET 設定時に Authorization: Bearer を自動付与する。
  // 手動実行用に ?secret= も許可。CRON_SECRET 未設定の環境（ローカル）では素通り。
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  if (secret) {
    const bearer = req.headers.get("authorization");
    const qs = url.searchParams.get("secret");
    if (bearer !== `Bearer ${secret}` && qs !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const dateParam = url.searchParams.get("date");
  const endDate = dateParam && DATE_RE.test(dateParam) ? dateParam : undefined;

  try {
    const report = await buildWeeklyReport(endDate);
    let sent = false;
    if (emailConfigured()) {
      await sendEmail({ to: REPORT_TO, subject: report.subject, html: report.html, text: report.text });
      sent = true;
    }
    return Response.json({
      ok: true,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      sent,
      to: sent ? REPORT_TO : null,
      summary: report.summary,
    });
  } catch (err) {
    console.error("[report/weekly] error:", err);
    return Response.json({ ok: false, error: "レポート生成に失敗しました" }, { status: 500 });
  }
}
