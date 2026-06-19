import { kv } from "@vercel/kv";
import { sendEmail, REPORT_TO } from "../../../lib/email";

// 売切見張りワーカー(スマホ/住宅IP)の死活監視。cron-job.org から定期的に叩く(GitHub Actions schedule に依存しない)。
// ワーカーが書く心拍が古ければ「止まってる/ブロックされてる」と判断しメール通知。連投なし(状態遷移時＋down継続は24hごと)。
// 監視はクラウド側＝スマホ本体が死んでも気づける。CRON_SECRET で保護。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_H = Number(process.env.LIVENESS_STALE_HOURS) || 3;
const REMIND_H = Number(process.env.LIVENESS_REMIND_HOURS) || 24;

type RealRun = { at?: string };
type Status = { at?: string; soldout?: number; catalogHidden?: number };
type AlertState = { down?: boolean; since?: string | null; lastEmailAt?: string | null };

const fmtAge = (ms: number) => {
  if (!Number.isFinite(ms)) return "記録なし";
  const h = ms / 3600000;
  return h < 1 ? `${Math.round(h * 60)}分前` : `${Math.round(h * 10) / 10}時間前`;
};

function downHtml(ageMs: number) {
  return `
    <p>⚠️ <b>売切の見張りが止まっている／楽天にブロックされているようです。</b></p>
    <p>最後に在庫チェックが成立したのは <b>${fmtAge(ageMs)}</b>。${STALE_H}時間以上、正常な巡回がありません。</p>
    <p>このままだと、楽天で売切れた商品が利益商品一覧に残り続けます。スマホ（Pixel）を確認してください：</p>
    <ol>
      <li>電源が入っていて、<b>家のWiFi</b>に繋がっているか（充電もしっぱなしか）</li>
      <li>Termuxの通知に「<b>wake lock held</b>」が出ているか</li>
      <li>ループが止まっていたら、Termuxで再開：<br><code>bash ~/resale-research-app/scripts/termux-run.sh</code></li>
    </ol>
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
  const real = await kv.get<RealRun>("liveness_last_real_run"); // 実検査が成立した最終時刻(ok時のみ)
  const st = await kv.get<Status>("liveness_status");           // 直近の結果(表示用)
  const refAt = real?.at || st?.at || null;                    // 鮮度は実検査成立時刻を最優先
  const ageMs = refAt ? now - Date.parse(refAt) : Infinity;
  const down = !refAt || !Number.isFinite(ageMs) || ageMs > STALE_H * 3600000;
  const prev = (await kv.get<AlertState>("liveness_alert_state")) || { down: false, since: null, lastEmailAt: null };

  let action = "none";
  if (down) {
    const firstTime = !prev.down;
    const remindDue = prev.lastEmailAt ? now - Date.parse(prev.lastEmailAt) > REMIND_H * 3600000 : true;
    if (firstTime || remindDue) {
      await sendEmail({ to: REPORT_TO, subject: "⚠️ 輸出ラボ 売切見張りが止まっています", html: downHtml(ageMs) });
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
    await sendEmail({ to: REPORT_TO, subject: "✅ 輸出ラボ 売切見張りが復活しました", html: upHtml(st) });
    await kv.set("liveness_alert_state", { down: false, since: null, lastEmailAt: new Date(now).toISOString() });
    action = "recovered";
  }

  return Response.json({ ok: true, down, ageHours: Number.isFinite(ageMs) ? Math.round((ageMs / 3600000) * 10) / 10 : null, action });
}
