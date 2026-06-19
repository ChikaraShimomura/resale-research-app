import { kv } from "@vercel/kv";
import { sendEmail, REPORT_TO } from "../../../lib/email";

// 売切見張りワーカー(スマホ/住宅IP)の死活監視。cron-job.org から定期的に叩く(GitHub Actions schedule に依存しない)。
// ワーカーが書く心拍が古ければ「止まってる/ブロックされてる」と判断しメール通知。連投なし(状態遷移時＋down継続は24hごと)。
// 監視はクラウド側＝スマホ本体が死んでも気づける。CRON_SECRET で保護。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_H = Number(process.env.LIVENESS_STALE_HOURS) || 3;
const REMIND_H = Number(process.env.LIVENESS_REMIND_HOURS) || 24;
const GALLERY_STALE_H = Number(process.env.GALLERY_STALE_HOURS) || 12; // ギャラリーは約6hごと→12h超で異常

type RealRun = { at?: string };
type Status = { at?: string; soldout?: number; catalogHidden?: number };
type AlertState = { down?: boolean; since?: string | null; lastEmailAt?: string | null };

const fmtAge = (ms: number) => {
  if (!Number.isFinite(ms)) return "記録なし";
  const h = ms / 3600000;
  return h < 1 ? `${Math.round(h * 60)}分前` : `${Math.round(h * 10) / 10}時間前`;
};

function downHtml(reasons: string[]) {
  return `
    <p>⚠️ <b>住宅IPワーカー(スマホ)に異常があります。</b></p>
    <ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
    <p>スマホ（Pixel）を確認してください：電源ON＋<b>家のWiFi</b>＋Termuxの通知に「<b>wake lock held</b>」。止まっていたらTermuxで再開：</p>
    <p><code>bash ~/resale-research-app/scripts/termux-run.sh</code></p>
    <p>復活すると、自動で「復活しました」メールが届きます。</p>`;
}
function upHtml(st: Status | null) {
  return `<p>✅ <b>売切の見張りが復活しました。</b></p>
    <p>直近：${st?.at || "-"}（売切 ${st?.soldout ?? "-"} 件 / カタログ非表示 ${st?.catalogHidden ?? "-"} 件）。正常稼働中です。</p>`;
}

export async function GET(req: Request) {
  // 認証: ?secret= か Authorization: Bearer。専用の OPS_ALERT_SECRET を優先(無ければ CRON_SECRET)。
  // ＝Vercelのsensitiveで見れない CRON_SECRET を掘らずに、新しい既知の値(OPS_ALERT_SECRET)を1個作って使える。
  const secret = process.env.OPS_ALERT_SECRET || process.env.CRON_SECRET;
  const url = new URL(req.url);
  const bearer = req.headers.get("authorization");
  if (!secret || (bearer !== `Bearer ${secret}` && url.searchParams.get("secret") !== secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ?test=1 で配信確認用のテストメール
  if (url.searchParams.get("test") === "1") {
    await sendEmail({ to: REPORT_TO, subject: "🔔 輸出ラボ 死活監視テスト", html: "<p>これは死活監視のテスト配信です。届いていれば通知経路はOKです。</p>" });
    return Response.json({ ok: true, test: true });
  }

  const now = Date.now();
  // 売切検知(liveness): 実検査成立時刻を最優先・STALE_H(既定3h)超で異常
  const real = await kv.get<RealRun>("liveness_last_real_run");
  const st = await kv.get<Status>("liveness_status");
  const livenessAt = real?.at || st?.at || null;
  const livenessAge = livenessAt ? now - Date.parse(livenessAt) : Infinity;
  // ギャラリー取得(gallery): 約6hごと→GALLERY_STALE_H(既定12h)超で異常。心拍がまだ無い(移行直後)なら判定保留(誤報防止)。
  const gallery = await kv.get<RealRun>("gallery_last_run");
  const galleryAge = gallery?.at ? now - Date.parse(gallery.at) : null;

  const reasons: string[] = [];
  if (!livenessAt || !Number.isFinite(livenessAge) || livenessAge > STALE_H * 3600000)
    reasons.push(`売切検知が止まっています（最終 ${fmtAge(livenessAge)}）`);
  if (galleryAge != null && galleryAge > GALLERY_STALE_H * 3600000)
    reasons.push(`ギャラリー取得が止まっています（最終 ${fmtAge(galleryAge)}）`);
  const down = reasons.length > 0;
  const prev = (await kv.get<AlertState>("liveness_alert_state")) || { down: false, since: null, lastEmailAt: null };

  let action = "none";
  if (down) {
    const firstTime = !prev.down;
    const remindDue = prev.lastEmailAt ? now - Date.parse(prev.lastEmailAt) > REMIND_H * 3600000 : true;
    if (firstTime || remindDue) {
      await sendEmail({ to: REPORT_TO, subject: "⚠️ 輸出ラボ 住宅IPワーカーが止まっています", html: downHtml(reasons) });
      await kv.set("liveness_alert_state", {
        down: true,
        since: firstTime ? new Date(now).toISOString() : prev.since || new Date(now).toISOString(),
        lastEmailAt: new Date(now).toISOString(),
      });
      action = firstTime ? "down-alert" : "down-remind";
    } else {
      action = "down-suppressed";
    }
  } else if (prev.down) {
    await sendEmail({ to: REPORT_TO, subject: "✅ 輸出ラボ 住宅IPワーカーが復活しました", html: upHtml(st) });
    await kv.set("liveness_alert_state", { down: false, since: null, lastEmailAt: new Date(now).toISOString() });
    action = "recovered";
  }

  return Response.json({
    ok: true, down, reasons, action,
    livenessAgeH: Number.isFinite(livenessAge) ? Math.round((livenessAge / 3600000) * 10) / 10 : null,
    galleryAgeH: galleryAge != null ? Math.round((galleryAge / 3600000) * 10) / 10 : null,
  });
}
