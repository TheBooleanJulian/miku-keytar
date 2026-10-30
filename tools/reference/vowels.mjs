// How recognisable are the five vowels across pitch? Renders あ い う え お at several pitches through the real
// engine, turns each into a smooth spectral envelope, and classifies every rendering against templates built from the
// OTHER pitches (leave-one-pitch-out). Prints accuracy, the margin to the nearest wrong vowel, and the worst confusions.
//
//   node tools/reference/vowels.mjs [workdir] [preset] ['{"vowelContrast":0.8}']
//   (needs `npm run dev`; preset defaults to "miku"; the optional JSON patches the preset, to try a setting)
import { startSynth } from "./synth.mjs";
import { noteFeatures } from "./features.mjs";

export const PITCHES = [196, 262, 330, 392, 523, 784]; // G3 C4 E4 G4 C5 G5
export const VOWELS = [["u", 0], ["o", 0.25], ["a", 0.5], ["e", 0.75], ["i", 1]];
const GRID = Array.from({ length: 48 }, (_, i) => 150 * Math.pow(5000 / 150, i / 47)); // 150 Hz .. 5 kHz, log spaced

/** Harmonic levels -> smooth envelope on a fixed log grid (so different pitches can be compared). */
export function envelope(harm) {
  const pts = harm.filter((h) => h.f >= 100 && h.f <= 6000);
  const out = GRID.map((g) => {
    let lo = pts[0], hi = pts[pts.length - 1];
    for (let i = 0; i < pts.length - 1; i++) if (pts[i].f <= g && pts[i + 1].f >= g) { lo = pts[i]; hi = pts[i + 1]; break; }
    if (g <= pts[0].f) return pts[0].db;
    if (g >= pts[pts.length - 1].f) return pts[pts.length - 1].db;
    const t = (Math.log(g) - Math.log(lo.f)) / (Math.log(hi.f) - Math.log(lo.f));
    return lo.db + (hi.db - lo.db) * t;
  });
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  return out.map((v) => v - mean); // loudness-free
}
const rms = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);

/** Renders every vowel at every pitch for one parameter set. */
export async function renderEnvelopes(synth, params) {
  const env = {};
  for (const [name, pos] of VOWELS) {
    env[name] = [];
    for (const f0 of PITCHES) {
      const x = await synth.render({ f0, y: 0.5, axis: "fixed", dur: 1.9, base: { ...params, vowelPos: pos } });
      const f = noteFeatures(x, synth.sr, f0, Math.round(0.4 * synth.sr), Math.round(1.8 * synth.sr), false);
      env[name].push(envelope(f.harm));
    }
  }
  return env;
}

/** Leave-one-pitch-out nearest-template classification. */
export function classify(env) {
  const names = VOWELS.map(([n]) => n);
  let correct = 0, total = 0, marginSum = 0;
  const confusions = {};
  const perPitch = PITCHES.map(() => 0);
  PITCHES.forEach((_, pi) => {
    const templates = names.map((n) => {
      const others = env[n].filter((_, k) => k !== pi);
      return GRID.map((_, g) => others.reduce((s, e) => s + e[g], 0) / others.length);
    });
    names.forEach((n, vi) => {
      const d = templates.map((t) => rms(env[n][pi], t));
      const best = d.indexOf(Math.min(...d));
      const wrong = Math.min(...d.filter((_, k) => k !== vi));
      marginSum += wrong - d[vi]; // positive: closer to the right vowel than to any wrong one
      total++;
      if (best === vi) { correct++; perPitch[pi]++; } else confusions[`${n}->${names[best]}@${PITCHES[pi]}`] = true;
    });
  });
  return { accuracy: correct / total, margin: marginSum / total, confusions: Object.keys(confusions), perPitch };
}

/** Mean pairwise distance between the five vowels, per pitch (dB RMS): how far apart they sit. */
export function separation(env) {
  const names = VOWELS.map(([n]) => n);
  return PITCHES.map((_, pi) => {
    let s = 0, c = 0;
    for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) { s += rms(env[names[a]][pi], env[names[b]][pi]); c++; }
    return s / c;
  });
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("vowels.mjs")) {
  const work = process.argv[2] ?? "ref/.analysis";
  const preset = process.argv[3] ?? "miku";
  const synth = await startSynth(work);
  const patch = process.argv[4] ? JSON.parse(process.argv[4]) : {};
  const params = { ...(await synth.builtin(preset)), ...patch };
  const env = await renderEnvelopes(synth, params);
  const r = classify(env);
  const sep = separation(env);
  console.log(`preset ${preset}${process.argv[4] ? " " + process.argv[4] : ""}: vowel recognition across pitch (leave-one-pitch-out): ${(r.accuracy * 100).toFixed(0)}%   margin ${r.margin.toFixed(1)} dB`);
  console.log(`  separation between vowels (dB RMS) at ${PITCHES.join(" / ")} Hz: ` + sep.map((v) => v.toFixed(1)).join(" / "));
  if (r.confusions.length) console.log("  confused: " + r.confusions.join(", "));
  synth.close();
  process.exit(0);
}
