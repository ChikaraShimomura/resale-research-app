// Pixel の見張り (scripts/torecaPixelWatch.mjs) の「送る/送らない・赤にする/しない」を決める所の表の試験 (2026-10-13)。
// 実行: node --test scripts/torecaPixelWatch.test.mjs   (通信しない・メールも送らない。外とのやり取りは作り物)
// 🔴 ここの表は「毎日メールが来ない」と「止まった事を知らせる道を失わない」の両方の約束。数字を変える時は表も直す。
import test from "node:test";
import assert from "node:assert/strict";
import { judge, decide, kvDownMail, exitCodeFor, mailOf, run, DOWN_MIN, DEAD_MIN, REMIND_H, STUCK_MIN, GIT_FAIL_LIMIT, RESTART_WINDOW_H } from "./torecaPixelWatch.mjs";

const T0 = Date.UTC(2026, 9, 13, 3, 0, 0); // 2026-10-13 12:00 JST
const MIN = 60e3;
const H = 3600e3;
const sec = (ms) => Math.floor(ms / 1000);
/** now の minAgo 分前に書かれた合図 (ほかの項目は extra・時刻は「now の何分前」で渡す) */
const hbAt = (now, minAgo, extra = {}) => JSON.stringify({ at: sec(now - minAgo * MIN), loopAt: sec(now - minAgo * MIN), worker: "alive", event: "生存確認", ver: "abc1234", ...extra });

test("決まりの数字: 止まった 60 分・起動できない 45 分・続報 72 時間", () => {
  assert.deepEqual({ DOWN_MIN, DEAD_MIN, REMIND_H }, { DOWN_MIN: 60, DEAD_MIN: 45, REMIND_H: 72 });
});

test("judge の表: 合図の古さ・本体の様子から状態と種類を決める", () => {
  const ago = (min) => sec(T0 - min * MIN);
  const rows = [
    // [説明, 合図, 期待する state, 期待する kind]
    ["合図が無い", "", "down", "down"],
    ["合図が壊れている", "{こわれた", "down", "down"],
    ["合図に時刻が無い", JSON.stringify({ worker: "alive" }), "down", "down"],
    ["合図 2 分前", hbAt(T0, 2), "ok", "ok"],
    // 9/25 11:30・9/24 12:15・9/23 14:45 (JST) の途切れ = 26〜43 分で自分で戻った。前は 25 分で「止まりました」を送っていた
    ["合図 26 分前 (9/25 の途切れ)", hbAt(T0, 26), "ok", "ok"],
    ["合図 32 分前 (9/24 の途切れ)", hbAt(T0, 32), "ok", "ok"],
    ["合図 43 分前", hbAt(T0, 43), "ok", "ok"],
    ["合図 60 分前ちょうど", hbAt(T0, 60), "ok", "ok"],
    ["合図 61 分前", hbAt(T0, 61), "down", "down"],
    ["合図 62 分前 (9/22 の停止)", hbAt(T0, 62), "down", "down"],
    // 見守りの起こし直しは 5〜16 分かかる。前は 9 分で「起動できていません」を送っていた
    ["本体が 9 分起動できていない", hbAt(T0, 2, { worker: "dead", deadSince: ago(9) }), "ok", "ok"],
    ["本体が 16 分起動できていない", hbAt(T0, 2, { worker: "dead", deadSince: ago(16) }), "ok", "ok"],
    ["本体が 44 分起動できていない", hbAt(T0, 2, { worker: "dead", deadSince: ago(44) }), "ok", "ok"],
    ["本体が 45 分起動できていない", hbAt(T0, 2, { worker: "dead", deadSince: ago(45) }), "stuck", "dead"],
    ["鍵が通らない (401)", hbAt(T0, 2, { authCode: 401, authSince: ago(30) }), "stuck", "auth"],
    ["鍵が通らない (403)", hbAt(T0, 2, { authCode: 403 }), "stuck", "auth"],
    [`git の失敗 ${GIT_FAIL_LIMIT - 1} 回`, hbAt(T0, 2, { gitFails: GIT_FAIL_LIMIT - 1 }), "ok", "ok"],
    [`git の失敗 ${GIT_FAIL_LIMIT} 回`, hbAt(T0, 2, { gitFails: GIT_FAIL_LIMIT }), "stuck", "git"],
    ["見守りが 1 時間前に起こし直した", hbAt(T0, 2, { stuckAt: ago(60) }), "stuck", "restart"],
    [`見守りが ${RESTART_WINDOW_H} 時間前に起こし直した`, hbAt(T0, 2, { stuckAt: ago(RESTART_WINDOW_H * 60) }), "ok", "ok"],
    [`ループが ${STUCK_MIN} 分進んでいない`, hbAt(T0, 2, { loopAt: ago(STUCK_MIN) }), "ok", "ok"],
    [`ループが ${STUCK_MIN + 1} 分進んでいない`, hbAt(T0, 2, { loopAt: ago(STUCK_MIN + 1) }), "stuck", "loop"],
    // 重なった時の順: 止まった > 鍵 > 起動できない > git > 起こし直し > ループ
    ["合図 61 分前 + 鍵が通らない", hbAt(T0, 61, { authCode: 401 }), "down", "down"],
    ["鍵が通らない + 起動できない + git の失敗", hbAt(T0, 2, { authCode: 401, deadSince: ago(90), gitFails: 9 }), "stuck", "auth"],
    ["起動できない + git の失敗", hbAt(T0, 2, { deadSince: ago(90), gitFails: 9 }), "stuck", "dead"],
  ];
  for (const [what, hb, state, kind] of rows) {
    const cur = judge(hb, T0);
    assert.deepEqual({ state: cur.state, kind: cur.kind }, { state, kind }, what);
  }
});

test("decide の表: 始まりに 1 通・続報は 72 時間ごと・戻りに 1 通・種類の入れ替わりは 止まった⇔固まった と 鍵 と「起こし直しました」の後 だけ", () => {
  const bad = (state, kind, hAgo = 1, mailHAgo = hAgo) => ({ state, kind, since: T0 - hAgo * H, lastMailAt: T0 - mailHAgo * H });
  const ok = { state: "ok", since: T0 - 5 * H };
  const rows = [
    // [説明, 前の状態, 今の判定, 期待するメール]
    ["はじめての回・正常", null, { state: "ok", kind: "ok" }, null],
    ["正常 → 正常", ok, { state: "ok", kind: "ok" }, null],
    ["はじめての回・止まっている", null, { state: "down", kind: "down" }, "alert"],
    ["正常 → 止まった", ok, { state: "down", kind: "down" }, "alert"],
    ["正常 → 固まった (起動できない)", ok, { state: "stuck", kind: "dead" }, "alert"],
    ["正常 → 鍵が通らない", ok, { state: "stuck", kind: "auth" }, "alert"],
    ["止まったまま 15 分後", bad("down", "down", 0.25), { state: "down", kind: "down" }, null],
    ["止まったまま 12 時間 (前はここで続報)", bad("down", "down", 12), { state: "down", kind: "down" }, null],
    ["止まったまま 24 時間", bad("down", "down", 24), { state: "down", kind: "down" }, null],
    ["止まったまま 71 時間 59 分", bad("down", "down", 72 - 1 / 60), { state: "down", kind: "down" }, null],
    ["止まったまま 72 時間", bad("down", "down", 72), { state: "down", kind: "down" }, "remind"],
    ["止まって 100 時間・続報から 28 時間", bad("down", "down", 100, 28), { state: "down", kind: "down" }, null],
    ["止まって 144 時間・続報から 72 時間", bad("down", "down", 144, 72), { state: "down", kind: "down" }, "remind"],
    ["固まったまま 72 時間", bad("stuck", "loop", 72), { state: "stuck", kind: "loop" }, "remind"],
    // 固まった中での種類の入れ替わりは送らない (前は種類が変わるたびに 1 通)
    ["起動できない → 起こし直した (今のまま送らない)", bad("stuck", "dead"), { state: "stuck", kind: "restart" }, null],
    ["git の失敗 → 起こし直した", bad("stuck", "git"), { state: "stuck", kind: "restart" }, null],
    ["git の失敗 → ループが進まない", bad("stuck", "git"), { state: "stuck", kind: "loop" }, null],
    ["起動できない → git の失敗", bad("stuck", "dead"), { state: "stuck", kind: "git" }, null],
    ["鍵が通らない → git の失敗 (鍵は戻った)", bad("stuck", "auth"), { state: "stuck", kind: "git" }, null],
    // 🔴 「起こし直しました」と知らせた後で、別の固まり方になった時は 1 通 (2026-10-14 の点検)。
    //    「起こし直しました」は「自分で直した」という知らせ = その後で直っていないのに黙ると、その 1 通だけが 72 時間残る
    ["起こし直した → 起動できない", bad("stuck", "restart"), { state: "stuck", kind: "dead" }, "alert"],
    ["起こし直した → git の失敗", bad("stuck", "restart"), { state: "stuck", kind: "git" }, "alert"],
    ["起こし直した → ループが進まない", bad("stuck", "restart"), { state: "stuck", kind: "loop" }, "alert"],
    ["起こし直した → 鍵が通らない", bad("stuck", "restart"), { state: "stuck", kind: "auth" }, "alert"],
    ["起こし直した → 起こし直した (繰り返し・6 時間の窓の中)", bad("stuck", "restart", 5), { state: "stuck", kind: "restart" }, null],
    ["起こし直した → 起こし直した 72 時間", bad("stuck", "restart", 72), { state: "stuck", kind: "restart" }, "remind"],
    // 直し方が変わる時だけ送る
    ["起動できない → 鍵が通らない", bad("stuck", "dead"), { state: "stuck", kind: "auth" }, "alert"],
    ["git の失敗 → 鍵が通らない", bad("stuck", "git"), { state: "stuck", kind: "auth" }, "alert"],
    ["鍵が通らない → 鍵が通らない", bad("stuck", "auth"), { state: "stuck", kind: "auth" }, null],
    ["固まった → 止まった", bad("stuck", "loop"), { state: "down", kind: "down" }, "alert"],
    ["鍵が通らない → 止まった", bad("stuck", "auth"), { state: "down", kind: "down" }, "alert"],
    ["止まった → 固まった (起こし直した)", bad("down", "down"), { state: "stuck", kind: "restart" }, "alert"],
    ["止まった → 鍵が通らない", bad("down", "down"), { state: "stuck", kind: "auth" }, "alert"],
    // 戻り
    ["止まった → 正常", bad("down", "down", 3), { state: "ok", kind: "ok" }, "recovered"],
    ["固まった → 正常", bad("stuck", "git", 3), { state: "ok", kind: "ok" }, "recovered"],
  ];
  for (const [what, prev, cur, mail] of rows) assert.equal(decide(prev, cur, T0).mail, mail, what);

  // 状態の進め方
  const started = decide(ok, { state: "down", kind: "down" }, T0).next;
  assert.deepEqual(started, { state: "down", kind: "down", since: T0, lastMailAt: T0 }, "始まり: since と lastMailAt を今に");
  const quiet = bad("stuck", "dead");
  assert.equal(decide(quiet, { state: "stuck", kind: "restart" }, T0).next, quiet, "送らない時は状態を動かさない");
  const notFixed = decide(bad("stuck", "restart", 1), { state: "stuck", kind: "dead" }, T0).next;
  assert.deepEqual(notFixed, { state: "stuck", kind: "dead", since: T0 - 1 * H, lastMailAt: T0 }, "起こし直しの後: 種類を今の物に進める (次の回からは送らない)・始まりの時刻は保つ");
  assert.equal(decide(notFixed, { state: "stuck", kind: "git" }, T0 + 15 * MIN).mail, null, "起こし直しの後の 1 通は、同じ停止の中で 1 回だけ");
  assert.equal(decide(notFixed, { state: "stuck", kind: "restart" }, T0 + 15 * MIN).mail, null, "起動できない → また起こし直した では送らない");
  const swapped = decide(bad("stuck", "dead", 5), { state: "down", kind: "down" }, T0).next;
  assert.deepEqual(swapped, { state: "down", kind: "down", since: T0 - 5 * H, lastMailAt: T0 }, "入れ替わり: 始まりの時刻は保つ・続報の時計は送った時から");
  const reminded = decide(bad("down", "down", 72), { state: "down", kind: "down" }, T0).next;
  assert.deepEqual(reminded, { state: "down", kind: "down", since: T0 - 72 * H, lastMailAt: T0 }, "続報: 始まりの時刻は保つ");
  const back = decide(bad("down", "down", 3), { state: "ok", kind: "ok" }, T0).next;
  assert.deepEqual(back, { state: "ok", since: T0, downSince: T0 - 3 * H }, "戻り");
});

/** 15 分おきの回を順に流して、送るメールを並べる (状態は decide の next を次の回へ渡す = 送れた時の動き) */
function replay(steps, start = T0, everyMin = 15) {
  let prev = null;
  const mails = [];
  steps.forEach((hbOf, i) => {
    const now = start + i * everyMin * MIN;
    const cur = judge(typeof hbOf === "function" ? hbOf(now) : hbOf, now);
    const d = decide(prev, cur, now);
    if (d.mail) mails.push(`${i}:${d.mail}:${cur.kind}`);
    prev = d.next;
  });
  return mails;
}

test("流してみる: 9/22〜9/28 の実際の途切れ (前は 9 通) → 長い停止の始まりと戻りの 4 通だけ", () => {
  // 見張りのログの「合図 N 分前」をそのまま並べた (D:/claude-tmp/mail-audit/critic/pw/results.txt)
  const ages = (list) => list.map((a) => (now) => hbAt(now, a));
  // 9/22 23:45〜 (JST): 32→106 分の停止。前は 32 分で始まり。今は 62 分で始まり・戻りで 1 通
  assert.deepEqual(replay(ages([2, 32, 46, 62, 76, 92, 106, 4, 9])), ["3:alert:down", "7:recovered:ok"]);
  // 9/24 12:15: 32 分の途切れ・9/25 11:30: 26 分の途切れ。前は「止まった→戻った」で 2 通ずつ。今は 0 通
  assert.deepEqual(replay(ages([7, 32, 4, 9])), []);
  assert.deepEqual(replay(ages([1, 26, 10, 5])), []);
  // 9/28 19:15〜9/29 09:45: 885 分 (14 時間 45 分) の停止。前は始まり・12 時間の続報・戻りの 3 通。今は始まりと戻りの 2 通
  const long = [5];
  for (let a = 30; a <= 885; a += 15) long.push(a);
  long.push(3);
  assert.deepEqual(replay(ages(long)), ["4:alert:down", `${long.length - 1}:recovered:ok`]);
});

test("流してみる: 10/8〜10/13 の 133 時間の停止 (15 分おき) → 始まり・72 時間の続報・戻りの 3 通", () => {
  const stopAt = T0;
  const steps = [];
  const runs = (133 * 60) / 15;
  for (let i = 0; i < runs; i++) steps.push(() => JSON.stringify({ at: sec(stopAt), loopAt: sec(stopAt), worker: "alive" }));
  steps.push((now) => hbAt(now, 3));
  const mails = replay(steps, stopAt + 5 * MIN);
  // 5 分後から 15 分おき: 61 分を超えるのは 4 回目 (65 分)。続報は始まりから 72 時間 = 288 回後
  assert.deepEqual(mails, ["4:alert:down", `${4 + 288}:remind:down`, `${runs}:recovered:ok`]);
});

test("流してみる: 固まったまま種類が入れ替わり続けても 1 通・鍵が通らなくなった時だけもう 1 通", () => {
  const ago = (now, min) => sec(now - min * MIN);
  const steps = [
    (now) => hbAt(now, 2),
    (now) => hbAt(now, 2, { worker: "dead", deadSince: ago(now, 50) }), // 起動できない → 始まり
    (now) => hbAt(now, 2, { stuckAt: ago(now, 5) }), // 起こし直した
    (now) => hbAt(now, 2, { stuckAt: ago(now, 20), gitFails: 7 }), // git の失敗
    (now) => hbAt(now, 2, { stuckAt: ago(now, 35) }), // 起こし直した (git は戻った)
    (now) => hbAt(now, 2, { authCode: 401, authSince: ago(now, 3) }), // 鍵が通らない → もう 1 通
    (now) => hbAt(now, 2, { stuckAt: ago(now, 65), gitFails: 6 }), // 鍵は戻った・git の失敗
    (now) => hbAt(now, 2, { authCode: 401, authSince: ago(now, 3) }), // また鍵 (同じ停止の中では 2 度送らない)
    (now) => hbAt(now, 2), // 戻った
  ];
  assert.deepEqual(replay(steps), ["1:alert:dead", "5:alert:auth", "8:recovered:ok"]);
});

test("🔴 流してみる: 見守りが固まった本体を止めた後、起こし直しが通らないまま 73 時間 → 「起こし直しました」の後に「起動できていません」が届く", () => {
  // toreca-kaitori-app の worker/heartbeat.sh の動きを写した合図 (10 分おき):
  //   固まった本体を止めて stuckAt を書く → start_worker が通らない (残った取得の子で assert-idle が待たせる等) →
  //   次の回 (10 分後) から deadSince が付く。合図は届き続けるので「止まった (down)」にはならない
  const S = sec(T0);
  const beat = (now) => {
    const k = Math.floor((sec(now) - S) / 600);
    return JSON.stringify({ at: S + k * 600, loopAt: S - 7200, worker: "dead", deadSince: k >= 1 ? S + 600 : 0, gitFails: 0, stuckAt: S });
  };
  const runs = (73 * 60) / 15;
  const steps = [(now) => hbAt(now, 2)];
  for (let i = 0; i <= runs; i++) steps.push(beat);
  // 見張りは止めた 2 分後から 15 分おき (steps[0] は止まる前の正常な回)
  const mails = replay(steps, T0 + 2 * MIN - 15 * MIN);
  // 1 回目 (+2 分) に「起こし直しました」。deadSince (+10 分) から 45 分 = +55 分を過ぎた最初の回 (+62 分 = 5 回目) に「起動できていません」。
  // 前はここで黙り、次のメールは 72 時間後の続報だった。続報の時計は 2 通目から 72 時間 = 288 回後。増えたのは 1 通だけ
  assert.deepEqual(mails, ["1:alert:restart", "5:alert:dead", `${5 + 288}:remind:dead`]);
  // 起こし直しが効いた時 (本体が立ち上がり、6 時間の窓が明けて正常) は、今までどおり始まりと戻りの 2 通だけ
  const fine = [(now) => hbAt(now, 2)];
  for (let i = 0; i < 26; i++) fine.push((now) => JSON.stringify({ at: sec(now - 2 * MIN), loopAt: sec(now - 4 * MIN), worker: "alive", deadSince: 0, gitFails: 0, stuckAt: S }));
  assert.deepEqual(replay(fine, T0 + 2 * MIN - 15 * MIN), ["1:alert:restart", "25:recovered:ok"]);
});

test("kvDownMail の表: 状態が読めない回は、止まっている時だけ・毎時 0〜14 分の回だけ送る", () => {
  const at = (h, m) => Date.UTC(2026, 9, 13, h, m, 30);
  const rows = [
    ["止まっている・3:00", "down", at(3, 0), "alert"],
    ["止まっている・3:07 (schedule の回)", "down", at(3, 7), "alert"],
    ["止まっている・3:14", "down", at(3, 14), "alert"],
    ["止まっている・3:15", "down", at(3, 15), null],
    ["止まっている・3:45", "down", at(3, 45), null],
    ["固まっている・4:00", "stuck", at(4, 0), "alert"],
    ["正常・3:00 (戻りは分からないので送らない)", "ok", at(3, 0), null],
  ];
  for (const [what, state, now, mail] of rows) assert.equal(kvDownMail({ state }, now), mail, what);
});

test("exitCodeFor の表: 鍵の設定漏れは毎回赤・ほかの失敗は 6 時間に 1 回だけ赤", () => {
  const at = (h, m) => new Date(Date.UTC(2026, 9, 13, h, m, 30));
  const rows = [
    ["鍵が無い・いつでも", "足りない: RESEND_API_KEY", at(3, 30), 1],
    ["鍵が無い・いつでも", "足りない: KV_REST_API_URL / KV_REST_API_TOKEN", at(7, 59), 1],
    ["メールを送れない・0:00", "メールを送れなかった: alert (Resend 500: {})", at(0, 0), 1],
    ["メールを送れない・0:07 (schedule の回)", "メールを送れなかった: alert (Resend 500: {})", at(0, 7), 1],
    ["メールを送れない・0:14", "メールを送れなかった: remind (Resend 403: {})", at(0, 14), 1],
    ["メールを送れない・0:15", "メールを送れなかった: alert (Resend 500: {})", at(0, 15), 0],
    ["メールを送れない・1:00", "メールを送れなかった: alert (Resend 500: {})", at(1, 0), 0],
    ["メールを送れない・5:59", "メールを送れなかった: recovered (fetch failed)", at(5, 59), 0],
    ["メールを送れない・6:00", "メールを送れなかった: recovered (fetch failed)", at(6, 0), 1],
    ["メールを送れない・12:10", "メールを送れなかった: alert (Resend 429: {})", at(12, 10), 1],
    ["メールを送れない・18:05", "メールを送れなかった: alert (Resend 429: {})", at(18, 5), 1],
    ["メールを送れない・18:30", "メールを送れなかった: alert (Resend 429: {})", at(18, 30), 0],
    ["KV が読めない・6:05", "KV が読めない (KV GET 500)", at(6, 5), 1],
    ["KV が読めない・9:05", "KV が読めない (KV GET 500)", at(9, 5), 0],
    ["KV に書けない・12:00", "KV に書けない (KV SET 500)", at(12, 0), 1],
    ["KV に書けない・13:00", "KV に書けない (KV SET 500)", at(13, 0), 0],
  ];
  for (const [what, msg, date, code] of rows) assert.equal(exitCodeFor(msg, date), code, `${what} ${date.toISOString()}`);
  // 15 分おき (毎時 0・15・30・45 分) に 1 日流すと、赤くなるのは 4 回だけ
  let red = 0;
  for (let i = 0; i < 96; i++) red += exitCodeFor("メールを送れなかった: alert (x)", new Date(Date.UTC(2026, 9, 13, 0, 0, 20) + i * 15 * MIN));
  assert.equal(red, 4);
});

/** 作り物の外の世界 (KV・メール)。何が呼ばれたかを残す */
function fakeIo({ state = null, kvGetFails = false, kvSetFails = false, sendFails = false } = {}) {
  const io = { state, sent: [], sets: [], logs: [] };
  io.kvGet = async () => {
    if (kvGetFails) throw new Error("KV GET 500");
    return io.state;
  };
  io.kvSet = async (value) => {
    if (kvSetFails) throw new Error("KV SET 500");
    io.sets.push(value);
    io.state = value;
  };
  io.sendMail = async (m) => {
    if (sendFails) throw new Error("Resend 500: {}");
    io.sent.push(m);
    return `id-${io.sent.length}`;
  };
  io.log = (line) => io.logs.push(line);
  return io;
}
const runWith = (io, hbRaw, nowMs, extra = {}) => run({ hbRaw, nowMs, kvGet: io.kvGet, kvSet: io.kvSet, sendMail: io.sendMail, log: io.log, ...extra });

test("run: ふだんの日は 0 通・状態も書き直さない", async () => {
  const io = fakeIo();
  const first = await runWith(io, hbAt(T0, 3), T0);
  assert.deepEqual({ mail: first.mail, wrote: first.wrote, sent: io.sent.length }, { mail: null, wrote: true, sent: 0 }, "はじめての回だけ「正常」を書く");
  for (let i = 1; i <= 96; i++) {
    const now = T0 + i * 15 * MIN;
    const r = await runWith(io, hbAt(now, (i % 3) * 4 + 1), now);
    assert.equal(r.mail, null);
    assert.equal(r.wrote, false);
  }
  assert.equal(io.sent.length, 0);
  assert.equal(io.sets.length, 1);
});

test("run: 止まった → 1 通送って状態を進める → 次の回は送らない → 戻って 1 通", async () => {
  const io = fakeIo({ state: JSON.stringify({ state: "ok", since: T0 - 5 * H }) });
  const stopped = JSON.stringify({ at: sec(T0 - 70 * MIN), loopAt: sec(T0 - 70 * MIN), worker: "alive", event: "秘密の出来事" });
  const a = await runWith(io, stopped, T0);
  assert.equal(a.mail, "alert");
  assert.match(io.sent[0].subject, /^🔴 Pixel が止まりました/);
  assert.match(io.sent[0].html, /72 時間ごと/);
  assert.equal(JSON.parse(io.state).state, "down");
  const b = await runWith(io, stopped, T0 + 15 * MIN);
  assert.deepEqual({ mail: b.mail, wrote: b.wrote }, { mail: null, wrote: false });
  const c = await runWith(io, hbAt(T0 + 30 * MIN, 2), T0 + 30 * MIN);
  assert.equal(c.mail, "recovered");
  assert.match(io.sent[1].subject, /^✅ Pixel が戻りました \(止まっていた時間 30分\)/);
  assert.equal(io.sent.length, 2);
  // 🔴 公開リポジトリ: ログに合図の中身 (出来事の文) を出さない
  assert.ok(!io.logs.join("\n").includes("秘密の出来事"));
});

test("🔴 run: メールを送れない時は黙らずに例外・状態は進めない → 次の回にもう一度送る", async () => {
  const before = JSON.stringify({ state: "ok", since: T0 - 5 * H });
  const io = fakeIo({ state: before, sendFails: true });
  const stopped = JSON.stringify({ at: sec(T0 - 70 * MIN), worker: "alive" });
  await assert.rejects(runWith(io, stopped, T0), /メールを送れなかった: alert \(Resend 500/);
  assert.equal(io.state, before, "状態を進めていない");
  assert.equal(io.sets.length, 0);
  assert.ok(io.logs.some((l) => l.startsWith("::error::メールを送れなかった")));
  // 次の回 (メールが通るようになった): 同じ始まりのメールが出る
  const io2 = fakeIo({ state: io.state });
  const r = await runWith(io2, stopped, T0 + 15 * MIN);
  assert.equal(r.mail, "alert");
  assert.equal(io2.sent.length, 1);
  // 戻りのメールも同じ (送れなければ「止まった」のまま持つ)
  const down = JSON.stringify({ state: "down", kind: "down", since: T0 - 3 * H, lastMailAt: T0 - 3 * H });
  const io3 = fakeIo({ state: down, sendFails: true });
  await assert.rejects(runWith(io3, hbAt(T0, 2), T0), /メールを送れなかった: recovered/);
  assert.equal(io3.state, down);
});

test("🔴 run: 状態 (KV) が読めない時は、決まりどおり警報を出してから例外 (黙って緑で終わらない)", async () => {
  const stopped = (now) => JSON.stringify({ at: sec(now - 70 * MIN), worker: "alive" });
  // 毎時 0〜14 分の回: 警報を出す (重なる事があると書き添える)・その後で例外
  const t1 = Date.UTC(2026, 9, 13, 3, 7, 0);
  const io = fakeIo({ kvGetFails: true });
  await assert.rejects(runWith(io, stopped(t1), t1), /KV が読めない/);
  assert.equal(io.sent.length, 1);
  assert.match(io.sent[0].html, /状態の記録が読めない/);
  assert.equal(io.sets.length, 0, "読めない時は書かない");
  // それ以外の回: 送らない・例外
  const t2 = Date.UTC(2026, 9, 13, 3, 22, 0);
  const io2 = fakeIo({ kvGetFails: true });
  await assert.rejects(runWith(io2, stopped(t2), t2), /KV が読めない/);
  assert.equal(io2.sent.length, 0);
  // 正常の日でも、読めない事は例外で知らせる
  const io3 = fakeIo({ kvGetFails: true });
  await assert.rejects(runWith(io3, hbAt(t1, 2), t1), /KV が読めない/);
  assert.equal(io3.sent.length, 0);
});

test("🔴 run: 状態 (KV) に書けない時は、メールを送った後で例外", async () => {
  const io = fakeIo({ state: JSON.stringify({ state: "ok", since: T0 - 5 * H }), kvSetFails: true });
  await assert.rejects(runWith(io, JSON.stringify({ at: sec(T0 - 70 * MIN) }), T0), /KV に書けない/);
  assert.equal(io.sent.length, 1, "メールは送っている");
});

test("run --dry: 判定だけ・KV もメールも触らない", async () => {
  const io = fakeIo({ kvGetFails: true, sendFails: true });
  const r = await runWith(io, "", T0, { dry: true });
  assert.equal(r.cur.state, "down");
  assert.deepEqual({ sent: io.sent.length, sets: io.sets.length }, { sent: 0, sets: 0 });
  assert.ok(io.logs.includes("DRY: 送らない"));
});

test("mailOf: 続報の件名・種類ごとの件名", () => {
  const cur = judge(JSON.stringify({ at: sec(T0 - 70 * MIN) }), T0);
  assert.match(mailOf("remind", cur, null, T0).subject, /^🔴 \(続報\) Pixel が止まりました/);
  const auth = judge(hbAt(T0, 2, { authCode: 401 }), T0);
  assert.equal(mailOf("alert", auth, null, T0).subject, "🔴 Pixel の GitHub の鍵が通りません");
});
