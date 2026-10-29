// Timbre features for one sustained note, from raw samples. Works on the reference and on rendered synth audio.
import { fft, meanSpectrum, bandDb, medianOf, midiOf, yin, db } from "./dsp.mjs";

export const BANDS = [
  [100, 300], [300, 600], [600, 1000], [1000, 1600], [1600, 2500], [2500, 4000], [4000, 6500], [6500, 10000], [10000, 16000],
];

/** Harmonic amplitudes (dB, relative to the strongest) at k*f0, plus valley depth between harmonics. */
export function harmonics(sp, sr, f0, maxHz = 12000) {
  const bin = sr / sp.N;
  const pts = [];
  for (let k = 1; k * f0 < maxHz; k++) {
    const c = k * f0;
    const half = Math.min(0.4 * f0, 0.035 * c + 6);
    let best = 0;
    for (let b = Math.floor((c - half) / bin); b <= Math.ceil((c + half) / bin); b++) best = Math.max(best, sp.power[b] ?? 0);
    pts.push({ k, f: c, p: best });
  }
  const peak = Math.max(...pts.map((q) => q.p));
  for (const q of pts) q.db = 10 * Math.log10((q.p + 1e-20) / peak);
  return pts;
}

/** Valley depth: mean peak-to-valley ratio (dB) for harmonics between 800 and 5000 Hz where harmonics are resolvable. */
export function valleyDepth(sp, sr, f0) {
  if (f0 > 700) return null;
  const bin = sr / sp.N;
  const out = [];
  for (let k = 3; (k + 0.5) * f0 < 5000; k++) {
    const c = k * f0;
    if (c < 800) continue;
    const half = 0.12 * f0;
    let pk = 0, vl = Infinity;
    for (let b = Math.floor((c - half) / bin); b <= Math.ceil((c + half) / bin); b++) pk = Math.max(pk, sp.power[b] ?? 0);
    const v = (k + 0.5) * f0;
    for (let b = Math.floor((v - 0.1 * f0) / bin); b <= Math.ceil((v + 0.1 * f0) / bin); b++) vl = Math.min(vl, sp.power[b] ?? Infinity);
    if (pk > 0 && isFinite(vl)) out.push(10 * Math.log10(pk / (vl + 1e-20)));
  }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : null;
}

/** Vibrato / pitch-wander of a stable note: dominant modulation rate (Hz) and its depth (cents, peak). */
export function vibrato(x, sr, from, to) {
  const W = 1024, hop = Math.round(sr * 0.005);
  const cents = [];
  for (let s = from; s + W + Math.floor(sr / 140) < to; s += hop) {
    const { f0, clarity } = yin(x, s, W, sr);
    if (clarity > 0.8) cents.push(1200 * Math.log2(f0 / 440));
  }
  if (cents.length < 200) return null;
  const n = cents.length, mean = cents.reduce((a, b) => a + b, 0) / n;
  // remove a straight-line trend so a slow glide is not mistaken for vibrato
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  cents.forEach((c, i) => { sx += i; sy += c; sxy += i * c; sxx += i * i; });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n;
  const d = cents.map((c, i) => c - (icpt + slope * i));
  const sd = Math.sqrt(d.reduce((a, b) => a + b * b, 0) / n);
  const N = 2048, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < Math.min(n, N); i++) re[i] = d[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (Math.min(n, N) - 1)));
  fft(re, im);
  const fs = 1 / 0.005;
  let bestK = 0, bestM = 0;
  for (let k = Math.ceil((2.5 * N) / fs); k < Math.floor((10 * N) / fs); k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > bestM) { bestM = m; bestK = k; }
  }
  const depth = (2 * bestM) / (Math.min(n, N) * 0.5); // Hann window compensates by 0.5
  return { sd, rate: (bestK * fs) / N, depth, mean };
}

export function noteFeatures(x, sr, f0, from, to, withVib = true) {
  const sp = meanSpectrum(x, from, to, 8192, withVib ? 2048 : 4096);
  const total = BANDS.reduce((a, [lo, hi]) => a + Math.pow(10, bandDb(sp, sr, lo, hi) / 10), 0);
  return {
    f0,
    bands: BANDS.map(([lo, hi]) => +(bandDb(sp, sr, lo, hi) - 10 * Math.log10(total)).toFixed(1)),
    harm: harmonics(sp, sr, f0),
    valley: valleyDepth(sp, sr, f0),
    vib: withVib ? vibrato(x, sr, from, to) : null,
    rmsDb: withVib ? db(Math.sqrt(x.slice(from, to).reduce((a, v) => a + v * v, 0) / (to - from))) : 0,
  };
}
