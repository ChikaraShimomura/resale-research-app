import { chromium } from 'playwright';
import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPOSER = 'file:///' + path.join(DIR, 'composer.html').split(path.sep).join('/');
const PUBLIC = path.join(DIR, '..', 'public', 'videos');
const SHORTS = path.join(PUBLIC, 'shorts');
const WORK = path.join(DIR, '_work');
const CACHE = path.join(DIR, 'audio', 'cache');
const BGM = path.join(DIR, 'bgm.wav');

const FADE = 0.6, LEAD = 0.5, TAIL = 1.1, BGM_VOL = 0.10;
// ナレーション: VOICEVOX（ローカルエンジン :50021）。声を変えるなら SPEAKER を変更
const ENGINE = 'http://127.0.0.1:50021';
const SPEAKER = 8;          // 春日部つむぎ（ノーマル）
const SPEED = 1.0;          // 速さ
const INTONATION = 1.0;     // 抑揚（人らしさ）
const PITCH = 0.0;          // 高さ
const VOLUME = 2.2;         // 音量（VOICEVOXは素が小さめなので持ち上げる）

const VLABEL = { overview: 'はじめてガイド', ebay: 'eBay登録ガイド', payoneer: 'Payoneer出金ガイド' };

const plans = JSON.parse(fs.readFileSync(path.join(DIR, 'plans.json'), 'utf8'));
const narration = JSON.parse(fs.readFileSync(path.join(DIR, 'narration.json'), 'utf8'));
const segments = JSON.parse(fs.readFileSync(path.join(DIR, 'segments.json'), 'utf8'));

fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(SHORTS, { recursive: true });

const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const q = (p) => `"${p}"`;
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const probeDur = (f) => parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 ${q(f)}`));

// ── VOICEVOX TTS with on-disk cache, returns cleaned wav + duration ──
const ttsMemo = new Map();
async function ttsWav(text) {
  if (ttsMemo.has(text)) return ttsMemo.get(text);
  const h = crypto.createHash('md5').update(`vv${SPEAKER}_${SPEED}_${INTONATION}_${PITCH}_${VOLUME}_` + text).digest('hex').slice(0, 16);
  const wav = path.join(CACHE, h + '.wav');
  if (!fs.existsSync(wav)) {
    const raw = path.join(CACHE, h + '_raw.wav');
    const qr = await fetch(`${ENGINE}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`, { method: 'POST' });
    if (!qr.ok) throw new Error(`VOICEVOX audio_query failed (${qr.status}). エンジンが起動しているか確認してください。`);
    const query = await qr.json();
    query.speedScale = SPEED; query.intonationScale = INTONATION; query.pitchScale = PITCH;
    query.volumeScale = VOLUME;
    query.prePhonemeLength = 0.1; query.postPhonemeLength = 0.1;
    const sr = await fetch(`${ENGINE}/synthesis?speaker=${SPEAKER}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
    });
    fs.writeFileSync(raw, Buffer.from(await sr.arrayBuffer()));
    // trim leading/trailing silence + resample for mixing
    execSync(`ffmpeg -y -i ${q(raw)} -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse" -ar 44100 ${q(wav)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.rmSync(raw, { force: true });
  }
  const r = { wav, dur: probeDur(wav) };
  ttsMemo.set(text, r);
  return r;
}

// ── build the job list: full videos + per-segment shorts ──
function jobsFor(v) {
  const guide = v.key;
  const slides = v.plan.slides;
  const narr = narration[guide];
  const vlabel = VLABEL[guide];
  const seg = segments[guide];
  const jobs = [];

  // full
  jobs.push({
    key: guide, kind: 'full', out: path.join(PUBLIC, seg.fullName + '.mp4'),
    vlabel, slides: slides.map((s, i) => ({ ...s, narration: narr[i] })),
  });

  // segments
  for (const sg of seg.segments) {
    const segSlides = [
      { type: 'title', image: null, badge: '', title: sg.label, helper: '', hold: 3.0, narration: sg.narr },
      ...sg.slideIdx.map((i) => ({ ...slides[i], narration: narr[i] })),
    ];
    jobs.push({
      key: `${guide}_${sg.key}`, kind: 'short',
      out: path.join(SHORTS, `${seg.fullName}-${sg.key}.mp4`),
      vlabel, slides: segSlides,
    });
  }
  return jobs;
}

// ── rendering (persistent page) ──
async function renderFrames(page, job) {
  const dir = path.join(WORK, job.key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const screenTotal = job.slides.filter((s) => s.type === 'screen').length;
  let si = 0;
  const frames = [];
  for (let i = 0; i < job.slides.length; i++) {
    const s = job.slides[i];
    const data = { ...s };
    if (s.type === 'screen') {
      data.img = 'raw/' + s.image + '.png';
      data.vlabel = job.vlabel; data.vtitle = '';
      data.index = si; data.total = screenTotal; si++;
    }
    await page.goto(COMPOSER + '?s=' + job.key + i + '#' + b64(data), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready__ === true, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(120);
    const f = path.join(dir, String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: f, type: 'png' });
    // narration timing
    const { wav, dur } = await ttsWav(s.narration);
    const base = Number(s.hold) || 3.5;
    frames.push({ file: f, wav, ndur: dur, hold: Math.max(base, LEAD + dur + TAIL) });
  }
  return frames;
}

function xfadeChain(frames) {
  const n = frames.length;
  const inputs = frames.map((f) => `-loop 1 -t ${f.hold.toFixed(3)} -i ${q(f.file)}`).join(' ');
  const norm = frames.map((_, i) => `[${i}:v]scale=1080:1920,setsar=1,format=yuv420p[v${i}]`).join(';');
  let chain = '', cum = frames[0].hold;
  for (let i = 0; i < n - 1; i++) {
    const off = cum - FADE;
    const a = i === 0 ? '[v0]' : `[xf${i - 1}]`;
    const out = i === n - 2 ? '[vout]' : `[xf${i}]`;
    chain += `;${a}[v${i + 1}]xfade=transition=fade:duration=${FADE}:offset=${off.toFixed(3)}${out}`;
    cum += frames[i + 1].hold - FADE;
  }
  return { inputs, fc: `${norm}${chain}`, map: n === 1 ? '[v0]' : '[vout]' };
}

function encodeSilent(frames, outMp4) {
  if (frames.length === 1) {
    execSync(`ffmpeg -y -loop 1 -t ${frames[0].hold.toFixed(3)} -i ${q(frames[0].file)} -vf "scale=1080:1920,setsar=1,format=yuv420p" -r 30 -c:v libx264 -crf 19 ${q(outMp4)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
    return;
  }
  const { inputs, fc, map } = xfadeChain(frames);
  execSync(`ffmpeg -y ${inputs} -filter_complex "${fc}" -map "${map}" -c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 19 ${q(outMp4)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function timeline(frames) {
  const starts = [];
  for (let i = 0; i < frames.length; i++) {
    if (i === 0) starts.push(0);
    else { let s = 0; for (let k = 0; k < i; k++) s += frames[k].hold; starts.push(s - (i - 1) * FADE); }
  }
  return starts;
}

function mux(silent, frames, outMp4) {
  const dur = probeDur(silent);
  const starts = timeline(frames);
  const inputs = [`-i ${q(silent)}`, `-stream_loop -1 -i ${q(BGM)}`];
  frames.forEach((f) => inputs.push(`-i ${q(f.wav)}`));
  const fadeOut = Math.max(0, dur - 1.4);
  let fc = `[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.4[bgm];`;
  const labels = [];
  frames.forEach((f, i) => {
    const ms = Math.max(0, Math.round((starts[i] + LEAD) * 1000));
    fc += `[${i + 2}:a]adelay=${ms}|${ms}[n${i}];`;
    labels.push(`[n${i}]`);
  });
  fc += `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[narr];`;
  fc += `[narr][bgm]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95,aresample=44100[aout]`;
  execSync(`ffmpeg -y ${inputs.join(' ')} -filter_complex "${fc}" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -t ${dur.toFixed(2)} -movflags +faststart ${q(outMp4)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
  // poster
  const poster = outMp4.replace(/\.mp4$/, '-poster.jpg');
  execSync(`ffmpeg -y -ss 0.3 -i ${q(outMp4)} -frames:v 1 -q:v 4 ${q(poster)}`, { stdio: ['ignore', 'ignore', 'pipe'] });
  return dur;
}

// ── run ──
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();

const allJobs = plans.videos.flatMap(jobsFor);
console.log(`${allJobs.length} jobs (3 full + ${allJobs.length - 3} shorts)\n`);
const summary = [];
for (const job of allJobs) {
  process.stdout.write(`• ${job.key} (${job.slides.length} slides) ... `);
  const frames = await renderFrames(page, job);
  const silent = path.join(WORK, job.key + '_silent.mp4');
  encodeSilent(frames, silent);
  const dur = mux(silent, frames, job.out);
  summary.push({ key: job.key, kind: job.kind, dur: Math.round(dur), file: path.relative(path.join(DIR, '..'), job.out) });
  console.log(`${Math.round(dur)}s -> ${path.basename(job.out)}`);
}
await browser.close();
fs.writeFileSync(path.join(DIR, 'produce_summary.json'), JSON.stringify(summary, null, 2));
console.log('\n==== done ====');
for (const s of summary) console.log(`${s.kind === 'full' ? '■' : '·'} ${s.key}: ${s.dur}s`);
