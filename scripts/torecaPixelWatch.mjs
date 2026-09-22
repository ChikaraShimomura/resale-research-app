#!/usr/bin/env node
// TCG買取表の Pixel ワーカーの見張り (2026-09-22・オーナー指示「Pixel の動きが止まったことは検知してすぐにメール送ってほしい」)。
//
// Pixel (toreca-kaitori-app/worker/heartbeat.sh) が10分ごとに、このリポジトリの Actions の変数 TORECA_PIXEL_HEARTBEAT に
// {"at":秒, "loopAt":秒, "worker":"alive|dead", "event":"…", "ver":"…"} を書く。ここは15分ごとに
// (.github/workflows/check-listings.yml の toreca-pixel-watch ジョブ・cron-job.org が dispatch) それを読み、
//   - 合図が DOWN_MIN 分より古い → 「止まった」(電源・通信・Termux ごと止まった)
//   - 本体が DEAD_MIN 分起動できていない (deadSince) → 「本体が動いていない」(スクリプトが壊れた等)
//   - git の取り込み/送信が GIT_FAIL_LIMIT 回続けて失敗 (gitFails) → 「データを送れていない」
//   - 見守りが直近 RESTART_WINDOW_H 時間に固まった本体を止めて起こし直した (stuckAt) → 「固まった」
//   - 合図は来ているがループが STUCK_MIN 分進んでいない → 「固まった」(見守りが起動し直しても戻らない)
//   (2026-09-22 夜の点検で、git の失敗・本体の起動失敗・固まり→起こし直しの繰り返しがメールにならない穴を塞いだ)
// になった瞬間にメールを1通、戻った瞬間に1通送る。止まったままなら REMIND_H 時間ごとにもう1通。
// 状態は KV (Upstash) の toreca_pixel_watch に持つ (二重送信しない)。
// 🔴 このリポジトリは公開なので、ログには合図の中身 (出来事の文) を出さない。経過時間と状態だけ。
// env: TORECA_PIXEL_HEARTBEAT / RESEND_API_KEY / KV_REST_API_URL / KV_REST_API_TOKEN / MAIL_TO(任意) / MAIL_FROM(任意)
//      --dry = 送らずに判定だけ
const HB_RAW = process.env.TORECA_PIXEL_HEARTBEAT || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const MAIL_FROM = process.env.MAIL_FROM || "TCG買取表 見張り <noreply@yushutsu-fukugyo.com>";
const MAIL_TO = (process.env.MAIL_TO || "chikara0323@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry");
const KV_KEY = "toreca_pixel_watch";
const DOWN_MIN = 25; // 合図は10分ごと。2回続けて来なければ止まったとみなす
const STUCK_MIN = 150; // 見守りは2時間で起動し直す (本体は長い処理の前にも印を打つ)。それでも2時間半進んでいなければ固まったまま
const DEAD_MIN = 9; // 合図は10分ごと。2回続けて本体が死んでいた (起こし直しても立ち上がらない)
const GIT_FAIL_LIMIT = 6; // 本体のループは5分ごと。約30分ぶん続けて git が失敗
const RESTART_WINDOW_H = 6; // 見守りが固まった本体を起こし直してから、この時間は「固まった」として扱う
const REMIND_H = 12;
const STATUS_URL = "https://github.com/ChikaraShimomura/toreca-kaitori-app/blob/worker-status/pixel-status.md";

const jst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ");
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)}時間${Math.round(min % 60)}分` : `${Math.round(min)}分`);

/** 合図の読み取りと判定 (テストから読むので export) */
export function judge(hbRaw, nowMs) {
  let hb = null;
  try {
    hb = hbRaw ? JSON.parse(hbRaw) : null;
  } catch {
    hb = null;
  }
  if (!hb || !Number.isFinite(Number(hb.at))) return { state: "down", kind: "down", reason: "合図が読めない", hb: null, hbAgeMin: Infinity, loopAgeMin: null };
  const hbAgeMin = (nowMs / 1000 - Number(hb.at)) / 60;
  const loopAt = Number(hb.loopAt);
  const loopAgeMin = loopAt > 0 ? (nowMs / 1000 - loopAt) / 60 : null;
  const base = { hb, hbAgeMin, loopAgeMin };
  if (hbAgeMin > DOWN_MIN) return { ...base, state: "down", kind: "down", reason: `最後の合図から ${dur(hbAgeMin)}` };
  const deadSince = Number(hb.deadSince) || 0;
  const deadMin = deadSince > 0 ? (nowMs / 1000 - deadSince) / 60 : 0;
  if (deadMin >= DEAD_MIN) return { ...base, state: "stuck", kind: "dead", reason: `ワーカー本体が ${dur(deadMin)} 起動できていない` };
  const gitFails = Number(hb.gitFails) || 0;
  if (gitFails >= GIT_FAIL_LIMIT) return { ...base, state: "stuck", kind: "git", reason: `git の取り込み/送信が ${gitFails} 回続けて失敗している` };
  const stuckAt = Number(hb.stuckAt) || 0;
  if (stuckAt > 0 && nowMs / 1000 - stuckAt < RESTART_WINDOW_H * 3600) {
    return { ...base, state: "stuck", kind: "restart", reason: `見守りが ${jst(stuckAt * 1000)} に固まった本体を止めて起こし直した` };
  }
  if (loopAgeMin != null && loopAgeMin > STUCK_MIN) return { ...base, state: "stuck", kind: "loop", reason: `ワーカーのループが ${dur(loopAgeMin)} 進んでいない` };
  return { ...base, state: "ok", kind: "ok", reason: "" };
}

/** 前回の状態と今の判定から、送るメールを決める (テストから読むので export) */
export function decide(prev, cur, nowMs) {
  const bad = (s) => s === "down" || s === "stuck";
  if (bad(cur.state)) {
    if (!prev || !bad(prev.state)) return { mail: "alert", next: { state: cur.state, kind: cur.kind, since: nowMs, lastMailAt: nowMs } };
    if (prev.state !== cur.state || (prev.kind && cur.kind && prev.kind !== cur.kind)) {
      return { mail: "alert", next: { ...prev, state: cur.state, kind: cur.kind, lastMailAt: nowMs } };
    }
    if (nowMs - (prev.lastMailAt || 0) >= REMIND_H * 3600e3) return { mail: "remind", next: { ...prev, lastMailAt: nowMs } };
    return { mail: null, next: prev };
  }
  if (prev && bad(prev.state)) return { mail: "recovered", next: { state: "ok", since: nowMs, downSince: prev.since } };
  return { mail: null, next: prev && prev.state === "ok" ? prev : { state: "ok", since: nowMs } };
}

async function kv(cmd) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`KV ${cmd[0]} ${r.status}`);
  return (await r.json()).result;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function mailOf(kind, cur, prev, nowMs) {
  const last = cur.hb ? jst(Number(cur.hb.at) * 1000) : "不明";
  const lastEvent = cur.hb?.event ? esc(cur.hb.event) : "—";
  if (kind === "recovered") {
    const downMin = prev?.since ? (nowMs - prev.since) / 60000 : null;
    return {
      subject: `✅ Pixel が戻りました${downMin != null ? ` (止まっていた時間 ${dur(downMin)})` : ""}`,
      html: `<p>TCG買取表の Pixel ワーカーから、また合図が届くようになりました (${esc(jst(nowMs))} 確認)。</p>
<p>止まっていた間の店の取得や公式マスタは、次の巡回で自動的に取り直します。何もしなくて大丈夫です。</p>
<p style="color:#666;font-size:12px">様子: <a href="${STATUS_URL}">pixel-status.md</a></p>`,
    };
  }
  const head = kind === "remind" ? "🔴 (続報) " : "🔴 ";
  const SUBJECT = {
    down: `Pixel が止まりました (最後の合図 ${last})`,
    dead: "Pixel のワーカー本体が起動できていません",
    git: "Pixel が取ったデータを送れていません",
    restart: "Pixel のワーカーが固まり、起こし直しました",
    loop: "Pixel のワーカーが固まっています",
  };
  const WHAT = {
    down: "Pixel ごと止まっているか、通信が切れている可能性が高いです。<b>Pixel の電源・Wi-Fi・充電</b>を確かめてください (電源が入っていれば、再起動するだけで自動で動き出します)。",
    dead: "Pixel の中の見守りが10分ごとに起動し直していますが、すぐに落ちています。直近のプログラムの変更で壊れた可能性が高いので、PC 側で直して push すれば、次の起動で自動的に拾います。",
    git: "Pixel は動いていますが、取ったデータを GitHub に送れていません。PC 側で原因を調べて直します (状態は pixel-status.md に出ています)。",
    restart: "Pixel の中の見守りが、進まなくなったワーカーを止めて起動し直しました。繰り返すようなら PC 側で原因を調べます。",
    loop: "Pixel の中の見守りが起動し直していますが、まだ進んでいません。",
  };
  const k = cur.kind && SUBJECT[cur.kind] ? cur.kind : "down";
  return {
    subject: `${head}${SUBJECT[k]}`,
    html: `<p>TCG買取表の Pixel ワーカーについて、${esc(cur.reason)}。</p>
<ul>
<li>最後の合図: ${esc(last)} (${lastEvent})</li>
<li>止まっていると: カードラッシュ・クローブベース・遊々亭の価格が更新されない / X の新着・公式マスタの取得が止まる。日次ジョブ自体は安全網の定期実行で回ります</li>
</ul>
<p>${WHAT[k]} 戻ったらもう一度メールでお知らせします。</p>
<p style="color:#666;font-size:12px">様子: <a href="${STATUS_URL}">pixel-status.md</a> ・ 止まったままなら ${REMIND_H} 時間ごとにお知らせします</p>`,
  };
}

async function send({ subject, html }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.id;
}

async function main() {
  // 🔴 鍵が無ければ大きな声で落とす (静かに正常終了すると止まったことに誰も気づけない)
  const missing = [];
  if (!DRY && !RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!DRY && !(KV_URL && KV_TOKEN)) missing.push("KV_REST_API_URL / KV_REST_API_TOKEN");
  if (missing.length) throw new Error(`足りない: ${missing.join(", ")}`);
  const now = Date.now();
  const cur = judge(HB_RAW, now);
  const age = (m) => (m == null ? "-" : Number.isFinite(m) ? `${Math.round(m)}分` : "不明");
  console.log(`判定: ${cur.state} (合図 ${age(cur.hbAgeMin)}前・ループ ${age(cur.loopAgeMin)}前)`);
  if (DRY) {
    console.log("DRY: 送らない");
    return;
  }
  let prev = null;
  let kvDown = false;
  try {
    const raw = await kv(["GET", KV_KEY]);
    prev = raw ? JSON.parse(raw) : null;
  } catch (e) {
    kvDown = true;
    console.log(`::error::KV が読めない (${e?.message || e})`);
  }
  const isBad = cur.state === "down" || cur.state === "stuck";
  let mail = null;
  let next = null;
  if (kvDown) {
    // 状態が読めなくても警報は出す。重ならないよう1時間に1回 (毎時0〜14分の回) だけ
    mail = isBad && new Date(now).getUTCMinutes() < 15 ? "alert" : null;
  } else {
    ({ mail, next } = decide(prev, cur, now));
  }
  if (mail) {
    const m = mailOf(mail, cur, prev, now);
    if (kvDown) m.html += '<p style="color:#666;font-size:12px">⚠ 状態の記録が読めないため、同じお知らせが重なることがあります</p>';
    try {
      const id = await send(m);
      console.log(`メールを送った: ${mail} (${id})`);
    } catch (e) {
      // 送れなかったら状態を進めない (次の回にもう一度送る)。ジョブを毎回赤くしない
      console.log(`::error::メールを送れなかった (${e?.message || e})`);
      return;
    }
  }
  // 送れたときだけ状態を進める (先に書くと、送れなかった通知が二度と出ない)
  if (next && !kvDown && JSON.stringify(next) !== JSON.stringify(prev)) {
    try {
      await kv(["SET", KV_KEY, JSON.stringify(next)]);
    } catch (e) {
      console.log(`::error::KV に書けない (${e?.message || e})`);
    }
  }
}

if (process.argv[1] && /torecaPixelWatch\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    const msg = String(e?.message || e);
    console.error(`torecaPixelWatch: ${msg}`);
    // 鍵の設定漏れは毎回赤くする (一度直せば終わる)。ほかの一時的な失敗は6時間に1回だけ赤くする
    // (cron-job.org が15分ごとに起動するので、毎回赤いと GitHub の失敗メールが1日96通になる)
    const d = new Date();
    const always = /足りない:/.test(msg);
    process.exit(always || (d.getUTCHours() % 6 === 0 && d.getUTCMinutes() < 15) ? 1 : 0);
  });
}
