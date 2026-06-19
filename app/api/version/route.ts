// 現在デプロイされているバージョン(コミットSHA)を返す。クライアントが新デプロイを検知して
// 「更新」ボタンを出すのに使う。PWA(ホーム追加)だと引っぱり更新が効かず古いJSが残るための対策。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev";
  return Response.json({ v }, { headers: { "Cache-Control": "no-store" } });
}
