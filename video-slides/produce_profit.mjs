import { chromium } from 'playwright';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 利益商品 → 縦型ショート(2枚リビール)を量産。声=VOICEVOX春日部つむぎ + 自作lo-fi BGM
const DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPOSER = 'file:///' + path.join(DIR, 'composer.html').split(path.sep).join('/');
// SNS投稿用。Vercelにデプロイしないローカル専用フォルダに出力する
const OUTDIR = path.join(DIR, 'profit_out');
const WORK = path.join(DIR, '_work');
const CACHE = path.join(DIR, 'audio', 'cache');
const BGM = path.join(DIR, 'bgm.wav');
const API = 'https://www.yushutsu-fukugyo.com/api/products';

const FADE = 0.6, LEAD = 0.5, TAIL = 1.1, BGM_VOL = 0.10;
const ENGINE = 'http://127.0.0.1:50021';
const SPEAKER = 8, SPEED = 1.0, INTONATION = 1.0, PITCH = 0.0, VOLUME = 2.2;

const N = Number(process.argv[2]) || 2;

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUTDIR, { recursive: true });

const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const q = (p) => `"${p}"`;
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const probeDur = (f) => parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${q(f)}`));
const yen = (n) => '¥' + Math.round(n).toLocaleString('en-US');
const bigImg = (u) => !u ? u : (/_ex=\d+x\d+/.test(u) ? u.replace(/_ex=\d+x\d+/, '_ex=600x600') : u + (u.includes('?') ? '&' : '?') + '_ex=600x600');

// ── VOICEVOX TTS (cached) ──
const ttsMemo = new Map();
async function ttsWav(text) {
  if (ttsMemo.has(text)) return ttsMemo.get(text);
  const h = crypto.createHash('md5').update(`vv${SPEAKER}_${SPEED}_${INTONATION}_${PITCH}_${VOLUME}_` + text).digest('hex').slice(0, 16);
  const wav = path.join(CACHE, h + '.wav');
  if (!fs.existsSync(wav)) {
    const raw = path.join(CACHE, h + '_raw.wav');
    const qr = await fetch(`${ENGINE}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`, { method: 'POST' });
    if (!qr.ok) throw new Error(`VOICEVOX audio_query失敗(${qr.status})。エンジン起動を確認。`);
    const query = await qr.json();
    query.speedScale = SPEED; query.intonationScale = INTONATION; query.pitchScale = PITCH; query.volumeScale = VOLUME;
    query.prePhonemeLength = 0.1; query.postPhonemeLength = 0.1;
    const sr = await fetch(`${ENGINE}/synthesis?speaker=${SPEAKER}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
    fs.writeFileSync(raw, Buffer.from(await sr.arrayBuffer()));
    execSync(`ffmpeg -y -i ${q(raw)} -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse" -ar 44100 ${q(wav)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.rmSync(raw, { force: true });
  }
  const r = { wav, dur: probeDur(wav) };
  ttsMemo.set(text, r);
  return r;
}

// ── product → slides ──
function slidesFor(p) {
  const s = p.source || {};
  const img = bigImg(p.imageUrl);
  const rate = Math.round(p.realProfitRate);
  const pt = s.pointAmount || 0;
  const badges = [{ t: `利益率 ${rate}%`, c: 'green' }];
  if (pt > 0) badges.push({ t: `+${pt}pt`, c: 'pink' });
  return [
    { type: 'title', image: null, badge: '楽天 → eBay', title: '今日の\n利益商品', helper: '楽天で仕入れて海外で売ると…', hold: 2.6, narration: '今日の、利益が出る商品です。' },
    { type: 'profit', vlabel: '仕入れ → 想定売値', img, rows: [{ t: '楽天で仕入れ', v: yen(s.price) }, { t: 'eBay 想定売値', v: yen(p.realAvgPrice), c: 'blue' }], hold: 3.5, narration: `楽天で${Math.round(s.price)}円。eBayの相場は${Math.round(p.realAvgPrice)}円。` },
    { type: 'profit', vlabel: '差し引きの利益は…', img, hero: { t: '利益', v: yen(p.realProfit) }, badges, hold: 4.0, narration: `差し引きの利益は${Math.round(p.realProfit)}円。利益率${rate}パーセントです。` },
    { type: 'outro', image: null, badge: '無料アプリでチェック', title: '輸出ラボで\nもっと探す', helper: 'こんな商品が毎日見つかる', hold: 3.0, narration: '輸出ラボで、もっと探せます。' },
  ];
}

// ── render / encode / mux (produce.mjs と同方式) ──
async function renderFrames(page, key, slides) {
  const dir = path.join(WORK, key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const data = { ...s };
    await page.goto(COMPOSER + '?s=' + key + i + '#' + b64(data), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready__ === true, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(150);
    const f = path.join(dir, String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: f, type: 'png' });
    const { wav, dur } = await ttsWav(s.narration);
    frames.push({ file: f, wav, hold: Math.max(Number(s.hold) || 3, LEAD + dur + TAIL) });
  }
  return frames;
}

function encodeSilent(frames, out) {
  const n = frames.length;
  const inputs = frames.map((f) => `-loop 1 -t ${f.hold.toFixed(3)} -i ${q(f.file)}`).join(' ');
  const norm = frames.map((_, i) => `[${i}:v]scale=1080:1920,setsar=1,format=yuv420p[v${i}]`).join(';');
  let chain = '', cum = frames[0].hold;
  for (let i = 0; i < n - 1; i++) {
    const off = cum - FADE;
    const a = i === 0 ? '[v0]' : `[xf${i - 1}]`;
    const o = i === n - 2 ? '[vout]' : `[xf${i}]`;
    chain += `;${a}[v${i + 1}]xfade=transition=fade:duration=${FADE}:offset=${off.toFixed(3)}${o}`;
    cum += frames[i + 1].hold - FADE;
  }
  execSync(`ffmpeg -y ${inputs} -filter_complex "${norm}${chain}" -map "[vout]" -c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 19 ${q(out)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function mux(silent, frames, out) {
  const dur = probeDur(silent);
  const starts = [];
  for (let i = 0; i < frames.length; i++) {
    if (i === 0) starts.push(0);
    else { let s = 0; for (let k = 0; k < i; k++) s += frames[k].hold; starts.push(s - (i - 1) * FADE); }
  }
  const inputs = [`-i ${q(silent)}`, `-stream_loop -1 -i ${q(BGM)}`];
  frames.forEach((f) => inputs.push(`-i ${q(f.wav)}`));
  const fo = Math.max(0, dur - 1.4);
  let fc = `[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=1.2,afade=t=out:st=${fo.toFixed(2)}:d=1.4[bgm];`;
  const labels = [];
  frames.forEach((f, i) => { const ms = Math.max(0, Math.round((starts[i] + LEAD) * 1000)); fc += `[${i + 2}:a]adelay=${ms}|${ms}[n${i}];`; labels.push(`[n${i}]`); });
  fc += `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[narr];`;
  fc += `[narr][bgm]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95,aresample=44100[aout]`;
  execSync(`ffmpeg -y ${inputs.join(' ')} -filter_complex "${fc}" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -t ${dur.toFixed(2)} -movflags +faststart ${q(out)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
  execSync(`ffmpeg -y -ss 0.3 -i ${q(out)} -frames:v 1 -q:v 4 ${q(out.replace(/\.mp4$/, '-poster.jpg'))}`, { stdio: ['ignore', 'ignore', 'pipe'] });
  return dur;
}

// ── run ──
console.log('商品データ取得中...');
const data = await (await fetch(API)).json();
const arr = Array.isArray(data) ? data : (data.products || data.items || []);
const picks = arr
  .filter((p) => p.imageUrl && typeof p.realProfitRate === 'number' && p.realProfitRate >= 30 && p.realProfit > 0)
  .sort((a, b) => b.realProfitRate - a.realProfitRate)
  .slice(0, N);
console.log(`対象 ${picks.length} 本を生成（利益率トップ順）`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
const summary = [];
for (const p of picks) {
  const key = 'profit-' + String(p.id).replace(/[^a-zA-Z0-9_-]/g, '-');
  const out = path.join(OUTDIR, key + '.mp4');
  const slides = slidesFor(p);
  process.stdout.write(`• ${key} (利益${yen(p.realProfit)} 率${Math.round(p.realProfitRate)}%) ... `);
  const frames = await renderFrames(page, key, slides);
  const silent = path.join(WORK, key + '_silent.mp4');
  encodeSilent(frames, silent);
  const dur = mux(silent, frames, out);
  summary.push({ id: p.id, profit: p.realProfit, rate: Math.round(p.realProfitRate), dur: Math.round(dur), file: path.basename(out) });
  console.log(`${Math.round(dur)}s -> ${path.basename(out)}`);
}
await browser.close();
console.log('\n==== 利益商品ショート 完成 ====');
for (const s of summary) console.log(`profit-${s.id}: ${s.dur}s 利益${yen(s.profit)} 率${s.rate}%`);
