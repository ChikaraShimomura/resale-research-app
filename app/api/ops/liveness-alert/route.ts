import { kv } from "@vercel/kv";
import { sendEmail, REPORT_TO } from "../../../lib/email";

// 中古カタログ・ワーカー(スマホ/住宅IP)の死活監視。cron-job.org から定期的に叩く(GitHub Actions schedule に依存しない)。
// ワーカーが各ジョブ後に書く心拍(wlog:*)が古ければ「止まってる/ブロックされてる」と判断しメール通知。
// 連投なし(状態遷移時＋down継続は24hごと)。監視はクラウド側＝スマホ本体が死んでも気づける。CRON_SECRET で保護。
// ※ 旧「楽天の売切検知(liveness)/ギャラリー取得(gallery)」の心拍監視は無在庫モデル撤去に伴い廃止(2026-06-28)。
//    心拍は最頻ジョブ＝型番リファイン(refine・20分ごと・成否問わず記録)を主に、build/meta もフォールバックで見る。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_H = Number(process.env.LIVENESS_STALE_HOURS) || 3; // refineは20分ごと→3h超(=約9バッチ欠)で異常
const REMIND_H = Number(process.env.LIVENESS_REMIND_HOURS) || 24;

type Wlog = { at?: string; exit?: number | null; git?: string };
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
function upHtml(beat: Wlog | null) {
  return `<p>✅ <b>中古カタログ・ワーカーが復活しました。</b></p>
    <p>直近：${beat?.at || "-"}（${beat?.git || "-"}）。正常稼働中です。</p>`;
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
  // 心拍＝ワーカーが各ジョブ後に書く wlog:*。最頻の refine を主に、build/meta もフォールバック(=どれか新しければ生存)。
  const [refine, build, meta] = await Promise.all([
    kv.get<Wlog>("wlog:refine"),
    kv.get<Wlog>("wlog:build"),
    kv.get<Wlog>("wlog:meta"),
  ]);
  const beats = [refine, build, meta].filter((b): b is Wlog => !!b?.at);
  // 一度も心拍が無い(移行直後/初回起動前)はアラームを出さない＝誤警告回避(fail-safe)。本物の停止は次回以降が拾う。
  if (beats.length === 0) {
    return Response.json({ ok: true, down: false, unknown: true, action: "none" });
  }
  const freshest = beats.reduce((a, b) => (Date.parse(a.at!) >= Date.parse(b.at!) ? a : b));
  const age = now - Date.parse(freshest.at!);

  const reasons: string[] = [];
  if (age > STALE_H * 3600000) reasons.push(`ワーカーが止まっています（最終 ${fmtAge(age)}）`);
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
    await sendEmail({ to: REPORT_TO, subject: "✅ 輸出ラボ 住宅IPワーカーが復活しました", html: upHtml(freshest) });
    await kv.set("liveness_alert_state", { down: false, since: null, lastEmailAt: new Date(now).toISOString() });
    action = "recovered";
  }

  return Response.json({
    ok: true, down, reasons, action,
    ageH: Math.round((age / 3600000) * 10) / 10,
  });
}
