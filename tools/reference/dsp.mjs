// Small dependency-free DSP helpers for analysing a reference recording (and the synth) offline.
import fs from "node:fs";

export function readWav(path) {
  const b = fs.readFileSync(path);
  let off = 12, sr = 44100, dataOff = 0, dataLen = 0;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") sr = b.readUInt32LE(off + 12);
    if (id === "data") { dataOff = off + 8; dataLen = Math.min(sz, b.length - dataOff); break; }
    off += 8 + sz + (sz & 1);
  }
  const n = dataLen >> 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(dataOff + 2 * i) / 32768;
  return { x, sr };
}

export const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
export const hzOf = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
export const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

/** YIN pitch estimate for one frame. Returns { f0, clarity } (clarity 0..1). */
export function yin(x, start, W, sr, fmin = 140, fmax = 1500, thr = 0.12) {
  const tauMax = Math.floor(sr / fmin), tauMin = Math.floor(sr / fmax);
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const e = x[start + j] - x[start + j + tau]; s += e * e; }
    d[tau] = s;
  }
  const c = new Float32Array(tauMax + 1);
  c[0] = 1; let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; c[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let t = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (c[tau] < thr) { while (tau + 1 < tauMax && c[tau + 1] < c[tau]) tau++; t = tau; break; }
  }
  if (t < 0) { let best = tauMin; for (let tau = tauMin; tau <= tauMax; tau++) if (c[tau] < c[best]) best = tau; t = best; }
  const a = c[t - 1] ?? c[t], b = c[t], cc = c[t + 1] ?? c[t];
  const den = a - 2 * b + cc;
  const shift = den !== 0 ? (a - cc) / (2 * den) : 0;
  return { f0: sr / (t + shift), clarity: 1 - c[t] };
}

/** In-place radix-2 FFT. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Mean power spectrum (linear power per bin) over Hann-windowed frames of x in [from, to) samples. */
export function meanSpectrum(x, from, to, N = 4096, hop = 1024) {
  const half = N / 2, acc = new Float64Array(half);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let frames = 0;
  for (let s = from; s + N <= to; s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * win[i];
    fft(re, im);
    for (let k = 0; k < half; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  for (let k = 0; k < half; k++) acc[k] /= Math.max(frames, 1);
  return { power: acc, N, frames };
}

/** Power in [lo, hi) Hz of a spectrum from meanSpectrum, in dB. */
export function bandDb(sp, sr, lo, hi) {
  let s = 0;
  const bin = sr / sp.N;
  for (let k = Math.ceil(lo / bin); k < Math.min(sp.power.length, Math.floor(hi / bin)); k++) s += sp.power[k];
  return 10 * Math.log10(s + 1e-20);
}

const medianOf = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
export { medianOf };

/** Pitch track + note segmentation. */
export function trackPitch(x, sr) {
  const W = 1024, hop = Math.round(sr * 0.01);
  const frames = [];
  for (let s = 0; s + W + Math.floor(sr / 140) < x.length; s += hop) {
    let e = 0; for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
    const rms = Math.sqrt(e / W);
    const { f0, clarity } = yin(x, s, W, sr);
    frames.push({ t: s / sr, s, rms, f0, clarity, voiced: clarity > 0.85 && db(rms) > -48 });
  }
  return { frames, hop };
}

export function segmentNotes(frames, minDur = 0.2) {
  const segs = [];
  let cur = null, gap = 0;
  const close = () => { if (cur && cur.fr.length * 0.01 >= minDur) segs.push(cur); cur = null; };
  for (const fr of frames) {
    if (!fr.voiced) { if (cur && ++gap > 3) close(); continue; }
    gap = 0;
    const m = midiOf(fr.f0);
    if (cur) {
      const recent = cur.fr.slice(-8).map((q) => midiOf(q.f0));
      if (Math.abs(m - medianOf(recent)) * 100 > 120) close();
    }
    if (!cur) cur = { fr: [] };
    cur.fr.push(fr);
  }
  close();
  return segs.map((sg) => {
    const ms = sg.fr.map((q) => midiOf(q.f0));
    return { start: sg.fr[0].t, dur: sg.fr.length * 0.01, midi: medianOf(ms), frames: sg.fr, cents: ms };
  });
}
