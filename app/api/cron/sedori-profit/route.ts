// せどり帳 含み益メールの【Vercel Cron トリガー】＝GitHub Actions cron がこのリポジトリで
// 慢性的に60〜75分遅れる(実測)ため、時刻の正確な主系統としてこちらを使う。
// Vercel Cron が毎日 22:00 UTC(=翌朝7:00 JST) にこの GET を叩く → mailer の main() を実行して送信。
// 二重送信は main() 内の「本日送信済みガード(KV sedori_tb_sent:YYYY-MM-DD)」が GitHub 側と共通で防ぐ
// ＝どちらの系統が先に発火しても1日1通に収束する(GitHub側は遅れて来る予備として残す)。
// 認証: Vercel Cron は Authorization: Bearer <CRON_SECRET> を自動付与。手動確認用に ?secret= も許可。
import { main as runSedoriProfitMail } from "../../../../scripts/sedoriTorecabankProfitMail.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 買取表の取得+在庫の取得+送信で数秒。余裕を持たせる。

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("secret") || "";
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // ★mailer は「鍵が未設定なら何もせず正常終了」する設計(鍵を入れる前にActionsを赤くしないため)。
  // その静かな終了がVercel上では失敗を隠す(2026-08-12に実際に欠配)＝ここで先に検査して大声で落とす。
  const missing = ["SEDORI_SUPABASE_URL", "SEDORI_SUPABASE_ANON_KEY", "SEDORI_REPORT_TOKEN", "RESEND_API_KEY"]
    .filter((k) => !process.env[k]);
  if (missing.length) {
    return Response.json(
      { ok: false, error: `Vercelの環境変数が未設定: ${missing.join(", ")}（Settings → Environment Variables に追加して redeploy）` },
      { status: 500 }
    );
  }
  try {
    await runSedoriProfitMail();
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
