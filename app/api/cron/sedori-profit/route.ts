// せどり帳 含み益メールの【Vercel Cron トリガー】＝GitHub Actions cron がこのリポジトリで
// 慢性的に60〜75分遅れる(実測)ため、時刻の正確な主系統としてこちらを使う。
// Vercel Cron が毎日 00:30 UTC(=9:30 JST) にこの GET を叩く → mailer の main() を実行して送信。
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
  try {
    await runSedoriProfitMail();
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
