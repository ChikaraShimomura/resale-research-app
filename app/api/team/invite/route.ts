import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { getActorId } from "../../../lib/auth/actor";
import { getCurrentUserEmail } from "../../../lib/auth/plan";
import { checkMembership } from "../../../lib/auth/admin";
import { createInvite } from "../../../lib/team";
import { sendEmail, emailConfigured } from "../../../lib/email";

// チーム招待：オーナーがメールを指定→(1)会員か確認(非会員なら notMember)→(2)会員なら承認リンクをメール送信。
// 承認は本人ログインで二重に担保するので、ここでの会員確認は早期UX（registered_users 集合で判定）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 濫用/会員列挙の防止：1アクター20回/10分。
const rl = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(20, "10 m"), prefix: "rl:teaminvite:actor", analytics: false });

export async function POST(req: Request) {
  const actor = await getActorId();
  const ownerEmail = await getCurrentUserEmail();
  if (!actor || !ownerEmail) return Response.json({ ok: false, error: "ログインしてください。" }, { status: 401 });
  try {
    const { success } = await rl.limit(actor);
    if (!success) return Response.json({ ok: false, error: "短時間に招待しすぎです。少し待ってお試しください。" }, { status: 429 });
  } catch { /* フェイルオープン */ }

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return Response.json({ ok: false, error: "メールアドレスを正しく入力してください。" }, { status: 400 });
  }
  if (email === ownerEmail.toLowerCase()) {
    return Response.json({ ok: false, error: "自分は招待できません。" }, { status: 400 });
  }

  // (1) 会員か確認（3段階）。確実に非会員なら notMember を返してUIで「会員ではありません」を出す。
  //     不明(unknown=確認手段が無い)は弾かず招待を送る＝承認時の本人ログインで会員性を担保（実会員の取りこぼし防止）。
  const membership = await checkMembership(email);
  if (membership === "not-member") {
    return Response.json({ ok: true, notMember: true });
  }
  const unverified = membership === "unknown";

  // 同一メールへの再招待は新トークンで上書き＝最新リンクのみ有効。
  const token = await createInvite(actor, ownerEmail, email);
  const origin = (() => { try { return new URL(req.url).origin; } catch { return "https://www.yushutsu-fukugyo.com"; } })();
  const acceptUrl = `${origin}/team/accept?token=${encodeURIComponent(token)}`;
  // メール送信が未設定（RESEND_API_KEY無）の環境では送らず、承認リンクを返してオーナーが手動共有できるようにする（黙って失敗しない）。
  if (!emailConfigured()) {
    return Response.json({ ok: true, sent: false, emailOff: true, unverified, inviteUrl: acceptUrl });
  }
  try {
    await sendEmail({
      to: email,
      subject: "【輸出ラボ】チームへの招待",
      html: `<div style="font-family:sans-serif;color:#2D323B;line-height:1.7">
  <p><b>${ownerEmail}</b> さんから、輸出ラボの<b>チーム共有</b>に招待されました。</p>
  <p>承認すると、${ownerEmail} さんの<b>「仕入れた商品」一覧</b>と<b>収支（仕入れ額・売上額）</b>を見られるようになります。</p>
  <p style="margin:24px 0"><a href="${acceptUrl}" style="background:#2D323B;color:#fff;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block">招待を承認する</a></p>
  <p style="color:#888;font-size:12px">このリンクは7日間有効です。${email} のアカウントでログインして承認してください。心当たりがなければ無視して構いません。<br>輸出ラボ</p>
</div>`,
    });
  } catch {
    return Response.json({ ok: false, error: "メール送信に失敗しました。少し待ってお試しください。" }, { status: 502 });
  }
  return Response.json({ ok: true, sent: true, unverified });
}
