// トレカバンク買取メールの【Vercel Cron トリガー】＝GitHub Actions cron の不安定さ(遅延/稀なスキップ)対策の第2系統。
// Vercel Cron が毎日この GET を叩く → mailer の main() を実行して送信。二重送信は main() 内の「本日送信済みガード
// (KV tb_sent:YYYY-MM-DD)」が GitHub 側と共通で防ぐ＝どちらの系統が先に発火しても1日1通に収束する。
// 認証: Vercel Cron は Authorization: Bearer <CRON_SECRET> を自動付与（Vercel env に CRON_SECRET がある時）。手動確認用に ?secret= も許可。
// 実処理は scripts/torecabankKaitoriMail.mjs の main() を再利用（CLI実行時のみ自動起動する形にリファクタ済＝importでは走らない）。
import { main as runTorecabankMail } from "../../../../scripts/torecabankKaitoriMail.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 取得+送信は数秒だが余裕を持たせる。

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("secret") || "";
  if (!secret || (auth !== `Bearer ${secret}` && qs !== secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    await runTorecabankMail(); // 毎日フルリスト＋前日比。本日送信済みガードを尊重（GitHubと二重送信しない）。
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
