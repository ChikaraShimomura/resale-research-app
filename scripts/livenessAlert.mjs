#!/usr/bin/env node
// 売切見張りワーカー(スマホ/住宅IP)の死活監視。クラウド(GitHub Actions・2hごと)で実行。
// スマホが書く liveness_status の心拍が古ければ「止まってる」と判断し、Resendでメール通知する。
// スマホ本体が死んでも気づけるよう、監視はクラウド側に置く（スマホには依存しない）。
//
// 連投しない：down/up が切り替わった時だけ送る＋down継続中は REMIND_HOURS ごとに再通知。
// env: KV_REST_API_URL / KV_REST_API_TOKEN / RESEND_API_KEY（GitHub Secrets。ローカルは .env.local）
//      任意: MAIL_FROM / REPORT_TO / LIVENESS_STALE_HOURS(既定3) / LIVENESS_REMIND_HOURS(既定24)
//      LIVENESS_ALERT_TEST=1 でテストメールを1通送って終了（配信確認用）。
import fs from "node:fs";

try {
  const p = new URL("../.env.local", import.meta.url);
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* GitHub Actions では env から拾う */ }

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const H = { Authorization: `Bearer ${KV_TOKEN}` };
const STALE_H = Number(process.env.LIVENESS_STALE_HOURS) || 3;
const REMIND_H = Number(process.env.LIVENESS_REMIND_HOURS) || 24;
const TO = process.env.REPORT_TO || "chikara0323@gmail.com";
const FROM = process.env.MAIL_FROM || "輸出ラボBot <noreply@yushutsu-fukugyo.com>";

async function kvGet(key) {
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: H });
    const j = await r.json();
    if (j.result == null) return null;
    try { return JSON.parse(j.result); } catch { return j.result; }
  } catch { return null; }
}
async function kvSet(key, val) {
  await fetch(`${KV_URL}/pipeline`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify([["SET", key, JSON.stringify(val), "EX", String(180 * 24 * 3600)]]),
  });
}
async function sendEmail(subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("[alert] RESEND_API_KEY 未設定。送信スキップ:", subject); return; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html, text: html.replace(/<[^>]+>/g, "") }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  console.log("[alert] メール送信:", subject, "→", TO);
}

const fmtAge = (ms) => {
  if (!Number.isFinite(ms)) return "記録なし";
  const h = ms / 3600000;
  return h < 1 ? `${Math.round(h * 60)}分前` : `${Math.round(h * 10) / 10}時間前`;
};

function downHtml(ageMs) {
  return `
    <p>⚠️ <b>売切の見張りが止まっている／楽天にブロックされているようです。</b></p>
    <p>最後に在庫チェックが成立したのは <b>${fmtAge(ageMs)}</b>。${STALE_H}時間以上、正常な巡回がありません。</p>
    <p>このままだと、楽天で売切れた商品が利益商品一覧に残り続けます。スマホ（Pixel）を確認してください：</p>
    <ol>
      <li>電源が入っていて、<b>家のWiFi</b>に繋がっているか（充電もしっぱなしか）</li>
      <li>Termuxアプリの通知に「<b>wake lock held</b>」が出ているか</li>
      <li>ループが止まっていたら、Termuxで再開：<br><code>bash ~/resale-research-app/scripts/termux-run.sh</code></li>
    </ol>
    <p>復活すると、自動で「復活しました」メールが届きます。</p>`;
}
function upHtml(st) {
  return `
    <p>✅ <b>売切の見張りが復活しました。</b></p>
    <p>直近の実行：${st?.at || "-"}（売切 ${st?.soldout ?? "-"} 件 / カタログ非表示 ${st?.catalogHidden ?? "-"} 件）。正常に稼働しています。</p>`;
}

async function main() {
  if (!KV_URL || !KV_TOKEN) { console.error("KV env 未設定。中止。"); process.exit(1); }

  if (process.env.LIVENESS_ALERT_TEST === "1") {
    await sendEmail("🔔 輸出ラボ 死活監視テスト", "<p>これは死活監視メールのテスト配信です。届いていれば通知経路はOKです。</p>");
    console.log("テストメール送信のみで終了。");
    return;
  }

  const now = Date.now();
  const st = await kvGet("liveness_status");            // 直近の結果(復活通知の表示用)
  const real = await kvGet("liveness_last_real_run");   // 実検査が成立した最終時刻(ok時のみ更新)
  // 鮮度は「実検査が成立した時刻」を最優先＝楽天ブロックで実質ゼロ件でも liveness_status だけ新鮮に見える偽陰性を防ぐ。
  // 旧版ワーカー移行中は real が未生成なので liveness_status.at にフォールバック。
  const refAt = real?.at || st?.at || null;
  const ageMs = refAt ? now - Date.parse(refAt) : Infinity;
  const down = !refAt || !Number.isFinite(ageMs) || ageMs > STALE_H * 3600000;
  const prev = (await kvGet("liveness_alert_state")) || { down: false, since: null, lastEmailAt: null };

  if (down) {
    const firstTime = !prev.down;
    const remindDue = prev.lastEmailAt ? now - Date.parse(prev.lastEmailAt) > REMIND_H * 3600000 : true;
    if (firstTime || remindDue) {
      await sendEmail("⚠️ 輸出ラボ 売切見張りが止まっています", downHtml(ageMs));
      await kvSet("liveness_alert_state", {
        down: true,
        since: firstTime ? new Date(now).toISOString() : prev.since || new Date(now).toISOString(),
        lastEmailAt: new Date(now).toISOString(),
      });
      console.log(`DOWN: メール送信（最終 ${fmtAge(ageMs)}）`);
    } else {
      console.log(`DOWN だが通知済み（連投回避）。最終 ${fmtAge(ageMs)}`);
    }
  } else {
    if (prev.down) {
      await sendEmail("✅ 輸出ラボ 売切見張りが復活しました", upHtml(st));
      await kvSet("liveness_alert_state", { down: false, since: null, lastEmailAt: new Date(now).toISOString() });
      console.log("RECOVERED: 復活メール送信");
    } else {
      console.log(`OK（稼働中）。最終実行 ${fmtAge(ageMs)}`);
    }
  }
}

main().catch((e) => { console.error("livenessAlert fatal:", e); process.exit(1); });
