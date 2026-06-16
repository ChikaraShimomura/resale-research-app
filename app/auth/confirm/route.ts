// メール確認・パスワード再設定リンクの着地点。Supabase(@supabase/ssr, PKCE)は ?code= を、
// カスタムテンプレートは ?token_hash=&type= を渡してくる。両対応でセッション確立→端末データ移行→next へ。
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { migrateDeviceDataToAccount } from "../../lib/auth/migrate";
import { recordFunnelEvent } from "../../lib/funnelServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next") ?? "/search";

  const supabase = await createSupabaseServerClient();
  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    ok = !error;
  }

  if (ok) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const did = (await cookies()).get("rr_did")?.value;
      if (did) await migrateDeviceDataToAccount(did, `acct:${data.user.id}`);
      // 確認メール経由の登録完了を計上（from があればナッジ帰属も）。
      await recordFunnelEvent("signup");
      const from = url.searchParams.get("from")?.trim();
      if (from) await recordFunnelEvent(`signup_from_${from}`);
    }
    return Response.redirect(new URL(next, request.url), 302);
  }
  return Response.redirect(new URL("/login?e=confirm", request.url), 302);
}
