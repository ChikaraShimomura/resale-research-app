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
//   - 合図に「GitHub の鍵が通らない」(authCode = 401/403) が載っている → 「鍵が通らない」(2026-09-29)
//   メールの本文には、合図が途絶えた時刻・最後の出来事・最後の巡回/送信・鍵の様子を書く (2026-09-29・9/28 18:45 に鍵が 401 で
//   止まったとき「電源・Wi-Fi を確かめて」だけのメールになり、原因が分からなかった)。鍵が死ぬと合図そのものも書けないので、
//   「止まった」のメールにも鍵の失効を原因の候補として書く
//   (2026-09-22 夜の点検で、git の失敗・本体の起動失敗・固まり→起こし直しの繰り返しがメールにならない穴を塞いだ)
// になった瞬間にメールを1通、戻った瞬間に1通送る。止まったままなら REMIND_H 時間ごとにもう1通。
// 状態は KV (Upstash) の toreca_pixel_watch に持つ (二重送信しない)。
//
// 🔴 2026-10-13 静かにする直し (オーナー「毎日メールが来るような状況にせんといてほしい」・ただし止まった事を知らせる道は失わない):
//   見張りが生きていた 9/22〜9/30 の 8 日で 14 通・6 日に届いていた。うち 6 通は 31〜43 分の途切れの「止まった→戻った」。
//   - DOWN_MIN 25 → 60 (自分で戻る短い途切れでは送らない。気付くのは 25 分後 → 60 分後に延びる)
//   - DEAD_MIN 9 → 45 (見守りの起こし直しは 5〜16 分かかる。9 分のままだと起こし直しの途中で「起動できていません」が出る)
//   - REMIND_H 12 → 72 (止まったままの続報は 3 日に 1 通)
//   - 種類が変わった時の 1 通は「止まった ⇔ 固まった の入れ替わり」と「鍵が通らなくなった時」だけ
//     (固まった中での種類の入れ替わり = 起動できない → 起こし直した → git の失敗… では送らない)
//   - 🔴 黙って終わらない: メールを送れない時・状態 (KV) を読めない/書けない時は例外で終える
//     (下の exitCodeFor が 6 時間に 1 回だけ回を赤くする = GitHub の失敗メールが最後の砦)。前は送信の失敗でも緑で終わっていた
// 決める所は judge・decide・kvDownMail・exitCodeFor の 4 つの純粋な関数 (試験 scripts/torecaPixelWatch.test.mjs が表で固定)。
//
// 🔴 このリポジトリは公開なので、ログには合図の中身 (出来事の文) を出さない。経過時間と状態だけ。
// 🔴 check-listings.yml はこのファイル 1 つだけを取り出して動かす (sparse-checkout)。ほかのファイルを import しない。
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
export const DOWN_MIN = 60; // 合図は10分ごと。31〜43 分の途切れ (9/23・9/24・9/25) は自分で戻ったので、1 時間来なければ止まったとみなす
export const STUCK_MIN = 150; // 見守りは2時間で起動し直す (本体は長い処理の前にも印を打つ)。それでも2時間半進んでいなければ固まったまま
export const DEAD_MIN = 45; // 見守りは10分ごとに起こし直す (立ち上がるまで 5〜16 分)。45 分たっても本体が立ち上がらない
export const GIT_FAIL_LIMIT = 6; // 本体のループは5分ごと。約30分ぶん続けて git が失敗
export const RESTART_WINDOW_H = 6; // 見守りが固まった本体を起こし直してから、この時間は「固まった」として扱う
export const REMIND_H = 72; // 止まったままの続報は 3 日に 1 通 (前は 12 時間 = 長い停止で 1 日 2 通)
export const RED_EVERY_H = 6; // 例外で終わる時に回を赤くする間隔 (exitCodeFor)
const STATUS_URL = "https://github.com/ChikaraShimomura/toreca-kaitori-app/blob/worker-status/pixel-status.md";

const jst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace("-", "/").replace("T", " ");
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)}時間${Math.round(min % 60)}分` : `${Math.round(min)}分`);
const isBad = (state) => state === "down" || state === "stuck";

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
  const authCode = Number(hb.authCode) || 0;
  if (authCode >= 400) {
    const since = Number(hb.authSince) || 0;
    return { ...base, state: "stuck", kind: "auth", reason: `GitHub の鍵が通らない (HTTP ${authCode}${since > 0 ? `・${jst(since * 1000)} から` : ""})` };
  }
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

/**
 * 前回の状態と今の判定から、送るメールを決める (テストから読むので export)。
 * 返す: { mail: "alert" | "remind" | "recovered" | null, next: 次に KV に持つ状態 }
 *   - 始まり (ok → 止まった/固まった): alert を 1 通
 *   - 続いている間: REMIND_H 時間ごとに remind を 1 通。それまでは送らない
 *   - 続いている間に種類が変わった時: 「止まった ⇔ 固まった」の入れ替わりと、鍵が通らなくなった (auth) 時だけ alert
 *     (直し方が変わる = 電源・通信を見る / PC で直す / 鍵を入れ直す)。固まった中での種類の入れ替わりでは送らない
 *     (prev.kind は「最後に alert を送った時の種類」のまま持つ = 同じ停止の中で auth を 2 度は送らない)
 *   - 戻り (止まった/固まった → ok): recovered を 1 通
 */
export function decide(prev, cur, nowMs) {
  if (isBad(cur.state)) {
    if (!prev || !isBad(prev.state)) return { mail: "alert", next: { state: cur.state, kind: cur.kind, since: nowMs, lastMailAt: nowMs } };
    if (prev.state !== cur.state || (cur.kind === "auth" && prev.kind !== "auth")) {
      return { mail: "alert", next: { ...prev, state: cur.state, kind: cur.kind, lastMailAt: nowMs } };
    }
    if (nowMs - (prev.lastMailAt || 0) >= REMIND_H * 3600e3) return { mail: "remind", next: { ...prev, lastMailAt: nowMs } };
    return { mail: null, next: prev };
  }
  if (prev && isBad(prev.state)) return { mail: "recovered", next: { state: "ok", since: nowMs, downSince: prev.since } };
  return { mail: null, next: prev && prev.state === "ok" ? prev : { state: "ok", since: nowMs } };
}

/**
 * 状態 (KV) が読めない回に送るメール (テストから読むので export)。
 * 状態が読めなくても警報は出す。重ならないよう 1 時間に 1 回 (毎時 0〜14 分の回) だけ。戻りは分からないので送らない
 */
export function kvDownMail(cur, nowMs) {
  return isBad(cur.state) && new Date(nowMs).getUTCMinutes() < 15 ? "alert" : null;
}

/**
 * 例外で終わる時の終了コード = 回を赤くするか (テストから読むので export)。赤い回は GitHub が失敗メールを出す。
 *   - 鍵の設定漏れ (「足りない:」) は毎回赤くする (一度直せば終わる)
 *   - ほか (メールを送れない・KV が読めない/書けない・一時的な失敗) は RED_EVERY_H 時間に 1 回だけ赤くする
 *     = UTC の 0・6・12・18 時台の最初の 15 分に終わった回 (cron-job.org が15分ごとに起動するので、毎回赤いと失敗メールが 1 日 96 通になる)
 */
export function exitCodeFor(message, date) {
  if (/足りない:/.test(String(message))) return 1;
  return date.getUTCHours() % RED_EVERY_H === 0 && date.getUTCMinutes() < 15 ? 1 : 0;
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

/** メールの件名と本文 (テストから読むので export) */
export function mailOf(kind, cur, prev, nowMs) {
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
    auth: "Pixel の GitHub の鍵が通りません",
  };
  const WHAT = {
    down: "Pixel ごと止まっているか、通信が切れている可能性が高いです。<b>Pixel の電源・Wi-Fi・充電</b>を確かめてください (電源が入っていれば、再起動するだけで自動で動き出します)。",
    dead: "Pixel の中の見守りが10分ごとに起動し直していますが、すぐに落ちています。直近のプログラムの変更で壊れた可能性が高いので、PC 側で直して push すれば、次の起動で自動的に拾います。",
    git: "Pixel は動いていますが、取ったデータを GitHub に送れていません。PC 側で原因を調べて直します (状態は pixel-status.md に出ています)。",
    restart: "Pixel の中の見守りが、進まなくなったワーカーを止めて起動し直しました。繰り返すようなら PC 側で原因を調べます。",
    loop: "Pixel の中の見守りが起動し直していますが、まだ進んでいません。",
    auth: "Pixel の中の GitHub の鍵が失効しているか消されています。取り込み・送信・6:00 の日次の起動が止まっています。PC に保管した鍵で入れ直すと戻ります (toreca-kaitori-app の worker/README.md の手順1)。",
  };
  const k = cur.kind && SUBJECT[cur.kind] ? cur.kind : "down";
  const hb = cur.hb || {};
  const at = (sec) => (Number(sec) > 0 ? jst(Number(sec) * 1000) : "記録なし");
  const authCode = Number(hb.authCode) || 0;
  const details = [
    `最後の店の巡回: ${esc(at(hb.lastPass))} / 最後の送信: ${esc(at(hb.lastPush))}`,
    `鍵: ${authCode >= 400 ? `🔴 通らない (HTTP ${authCode}・${esc(at(hb.authSince))} から)` : "最後の合図の時点では通っていた"} / git の失敗の連続: ${Number(hb.gitFails) || 0} 回 / 版: ${esc(hb.ver || "?")}`,
  ];
  // 合図が途絶えたときの原因の候補 (鍵が死ぬと合図も書けないので、電源・通信と見分けがつかない)
  const causes =
    k === "down"
      ? `<p>考えられる原因: ① Pixel の電源・Wi-Fi・充電 ② <b>GitHub の鍵の失効 (401)</b> — 鍵が通らないと合図も書けないので「止まった」に見えます (2026-09-28 18:45 の例)。` +
        `最後の合図が正常 (鍵が通っていた・git の失敗 0 回) のまま途切れたなら両方ありえます。Pixel の Termux を開くと様子の画面が出て、鍵なら「🔴 GitHub の鍵が通らない」と出ます。</p>`
      : "";
  return {
    subject: `${head}${SUBJECT[k]}`,
    html: `<p>TCG買取表の Pixel ワーカーについて、${esc(cur.reason)}。</p>
<ul>
<li>最後の合図: ${esc(last)} (${lastEvent})</li>
${details.map((d) => `<li>${d}</li>`).join("\n")}
<li>止まっていると: カードラッシュ・クローブベース・遊々亭の価格が更新されない / X の新着・公式マスタの取得が止まる。日次ジョブ自体は安全網の定期実行で回ります</li>
</ul>
${causes}
<p>${WHAT[k]} 戻ったらもう一度メールでお知らせします (戻ったあと、止まっていた間の巡回と 6:00 の日次の起動は Pixel が自動で取り戻します)。</p>
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

/**
 * 1 回ぶんの見張り (テストから読むので export)。外とのやり取りは渡された関数だけ (kvGet・kvSet・sendMail)。
 * 返す: { cur, mail, wrote }
 * 🔴 黙って終わらない (2026-10-13): 次の時は例外を投げる (回を赤くするかは exitCodeFor)。
 *   - メールを送れない → その場で投げる。状態は進めない (次の回にもう一度送る・先に書くと送れなかった通知が二度と出ない)
 *   - 状態 (KV) が読めない → 警報は kvDownMail の決まりで出してから、最後に投げる
 *   - 状態 (KV) に書けない → メールは送り済み。最後に投げる (次の回に同じメールが重なる = 直すまで赤で知らせる)
 */
export async function run({ hbRaw, nowMs, kvGet, kvSet, sendMail, dry = false, log = console.log }) {
  const cur = judge(hbRaw, nowMs);
  const age = (m) => (m == null ? "-" : Number.isFinite(m) ? `${Math.round(m)}分` : "不明");
  log(`判定: ${cur.state} (合図 ${age(cur.hbAgeMin)}前・ループ ${age(cur.loopAgeMin)}前)`);
  if (dry) {
    log("DRY: 送らない");
    return { cur, mail: null, wrote: false };
  }
  const problems = [];
  let prev = null;
  let kvDown = false;
  try {
    const raw = await kvGet();
    prev = raw ? JSON.parse(raw) : null;
  } catch (e) {
    kvDown = true;
    problems.push(`KV が読めない (${e?.message || e})`);
    log(`::error::KV が読めない (${e?.message || e})`);
  }
  let mail = null;
  let next = null;
  if (kvDown) mail = kvDownMail(cur, nowMs);
  else ({ mail, next } = decide(prev, cur, nowMs));
  if (mail) {
    const m = mailOf(mail, cur, prev, nowMs);
    if (kvDown) m.html += '<p style="color:#666;font-size:12px">⚠ 状態の記録が読めないため、同じお知らせが重なることがあります</p>';
    let id = null;
    try {
      id = await sendMail(m);
    } catch (e) {
      log(`::error::メールを送れなかった (${e?.message || e})`);
      throw new Error(`メールを送れなかった: ${mail} (${e?.message || e})`);
    }
    log(`メールを送った: ${mail} (${id})`);
  }
  // 送れたときだけ状態を進める (先に書くと、送れなかった通知が二度と出ない)
  let wrote = false;
  if (next && !kvDown && JSON.stringify(next) !== JSON.stringify(prev)) {
    try {
      await kvSet(JSON.stringify(next));
      wrote = true;
    } catch (e) {
      problems.push(`KV に書けない (${e?.message || e})`);
      log(`::error::KV に書けない (${e?.message || e})`);
    }
  }
  if (problems.length) throw new Error(problems.join(" / "));
  return { cur, mail, wrote };
}

async function main() {
  // 🔴 鍵が無ければ大きな声で落とす (静かに正常終了すると止まったことに誰も気づけない)
  const missing = [];
  if (!DRY && !RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!DRY && !(KV_URL && KV_TOKEN)) missing.push("KV_REST_API_URL / KV_REST_API_TOKEN");
  if (missing.length) throw new Error(`足りない: ${missing.join(", ")}`);
  await run({
    hbRaw: HB_RAW,
    nowMs: Date.now(),
    kvGet: () => kv(["GET", KV_KEY]),
    kvSet: (value) => kv(["SET", KV_KEY, value]),
    sendMail: send,
    dry: DRY,
  });
}

if (process.argv[1] && /torecaPixelWatch\.mjs$/.test(process.argv[1])) {
  main().catch((e) => {
    const msg = String(e?.message || e);
    console.error(`torecaPixelWatch: ${msg}`);
    process.exit(exitCodeFor(msg, new Date()));
  });
}
