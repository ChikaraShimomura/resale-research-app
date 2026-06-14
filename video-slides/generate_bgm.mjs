import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 優しいlo-fi/チル系BGMループを合成（外部素材なし・ロイヤリティフリー）
// ジャジーな7thコード(ii-V-I-vi) + ローズ風EP + 柔らかいドラム + ヴァイナルノイズ + 暖かいローパス
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SR = 44100;
const BPM = 76;
const BEAT = 60 / BPM;          // 0.789s
const BARS = 8;
const SWING = 0.10;             // 8分のスウィング量(beat比)
const LOOP = BARS * 4 * BEAT;
const N = Math.ceil(LOOP * SR);
const buf = new Float32Array(N);

const F = {
  C2:65.41, D2:73.42, E2:82.41, F2:87.31, G2:98.0, A2:110.0, B2:123.47,
  C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196.0, A3:220.0, B3:246.94,
  C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.0, A4:440.0, B4:493.88,
  C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.0,
};

// ローズEP風: 基音+倍音、わずかにデチューンしたコーラス、柔らかいアタック、長めの減衰
function addRhodes(start, freq, dur, amp) {
  const s0 = Math.floor(start * SR);
  const len = Math.ceil((dur) * SR);
  const atk = Math.floor(0.018 * SR);
  const rel = dur;
  const det = 1.0015;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    let env = t < (atk / SR) ? (t / (atk / SR)) : Math.exp(-(t) / (rel * 0.5));
    // 倍音
    let s = Math.sin(2 * Math.PI * freq * t) * 1.0;
    s += Math.sin(2 * Math.PI * freq * det * t) * 0.5;        // chorus
    s += Math.sin(2 * Math.PI * freq * 2 * t) * 0.28;
    s += Math.sin(2 * Math.PI * freq * 3 * t) * 0.10;
    // 軽いトレモロ
    const trem = 1 + 0.05 * Math.sin(2 * Math.PI * 5 * t);
    buf[idx] += s * env * amp * trem;
  }
}

function addBass(start, freq, dur, amp) {
  const s0 = Math.floor(start * SR);
  const len = Math.ceil(dur * SR);
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= N) break;
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * Math.exp(-t / (dur * 0.5));
    let s = Math.sin(2 * Math.PI * freq * t) + 0.2 * Math.sin(2 * Math.PI * freq * 2 * t);
    buf[idx] += s * env * amp;
  }
}

function addKick(start, amp) {
  const s0 = Math.floor(start * SR);
  const len = Math.ceil(0.22 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= N) break;
    const t = i / SR;
    const f = 48 + (95 - 48) * Math.exp(-t * 30);
    phase += 2 * Math.PI * f / SR;
    buf[idx] += Math.sin(phase) * Math.exp(-t / 0.13) * amp;
  }
}

let seed = 991;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; }

function addSnare(start, amp) { // ダスティで控えめ
  const s0 = Math.floor(start * SR);
  const len = Math.ceil(0.14 * SR);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= N) break;
    const t = i / SR;
    const noise = rnd();
    lp = lp * 0.5 + noise * 0.5;                 // low-pass → dusty
    const tone = Math.sin(2 * Math.PI * 180 * t) * 0.3;
    buf[idx] += (lp + tone) * Math.exp(-t / 0.09) * amp;
  }
}

function addHat(start, amp) {
  const s0 = Math.floor(start * SR);
  const len = Math.ceil(0.04 * SR);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= N) break;
    const t = i / SR;
    const n = rnd(); const hp = n - prev; prev = n;
    buf[idx] += hp * Math.exp(-t / 0.015) * amp;
  }
}

// コード進行 Dm7 - G7 - Cmaj7 - Am7 (×2)  ローズは1拍目と3拍目に半音符
const chords = [
  { bass: 'D2', notes: ['D4', 'F4', 'A4', 'C5'] },
  { bass: 'G2', notes: ['G3', 'B3', 'D4', 'F4'] },
  { bass: 'C2', notes: ['C4', 'E4', 'G4', 'B4'] },
  { bass: 'A2', notes: ['A3', 'C4', 'E4', 'G4'] },
];
const bars = [0, 1, 2, 3, 0, 1, 2, 3].map(i => chords[i]);

for (let bar = 0; bar < BARS; bar++) {
  const ch = bars[bar];
  const t0 = bar * 4 * BEAT;
  // EPコード: 1拍目(2拍分)と3拍目(2拍分)
  for (const beatPos of [0, 2]) {
    const ts = t0 + beatPos * BEAT;
    for (const n of ch.notes) addRhodes(ts, F[n], BEAT * 1.9, 0.085);
  }
  // ベース: 1拍目、3拍目
  addBass(t0, F[ch.bass], BEAT * 1.6, 0.5);
  addBass(t0 + 2 * BEAT, F[ch.bass], BEAT * 1.4, 0.42);
  // ドラム: キック1&3、スネア2&4、ハット8分(スウィング)
  addKick(t0, 0.5);
  addKick(t0 + 2 * BEAT, 0.45);
  addSnare(t0 + 1 * BEAT, 0.22);
  addSnare(t0 + 3 * BEAT, 0.22);
  for (let b = 0; b < 4; b++) {
    addHat(t0 + b * BEAT, 0.06);
    addHat(t0 + (b + 0.5 + SWING) * BEAT, 0.045);   // スウィングした裏拍
  }
}

// ヴァイナルノイズ(常時・低レベル)＋たまにパチッ
for (let i = 0; i < N; i++) {
  buf[i] += rnd() * 0.006;
  if (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) > 0.99965) {
    buf[i] += rnd() * 0.18; // crackle pop
  }
}

// 暖かいワンポール・ローパス(~6kHz)
const dt = 1 / SR, rc = 1 / (2 * Math.PI * 6000), a = dt / (rc + dt);
let y = 0;
for (let i = 0; i < N; i++) { y = y + a * (buf[i] - y); buf[i] = y; }

// 正規化＋やわらかいサチュレーション
let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const g = 0.82 / (peak || 1);
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const s = Math.max(-1, Math.min(1, Math.tanh(buf[i] * g)));
  pcm.writeInt16LE((s * 32767) | 0, i * 2);
}
function wavHeader(L) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + L, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(L, 40);
  return h;
}
fs.writeFileSync(path.join(DIR, 'bgm.wav'), Buffer.concat([wavHeader(pcm.length), pcm]));
console.log(`ok lo-fi bgm.wav (${LOOP.toFixed(1)}s, ${BPM}BPM, ${(pcm.length / 1024).toFixed(0)}KB)`);
