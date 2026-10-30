// Analysis-by-synthesis: fit a handful of vocal parameters so the engine's あ matches the reference's spectral balance.
import fs from "node:fs";
import { startSynth } from "./synth.mjs";
import { noteFeatures, BANDS } from "./features.mjs";

const SP = process.argv[2];
const ref = JSON.parse(fs.readFileSync(`${SP}/ref-features.json`, "utf8"));
const synth = await startSynth(SP);
const sr = synth.sr;
const byName = (n, i = 0) => ref.filter((r) => r.name === n)[i];

// fit on the mid/high register, where one あ explains the reference; hold the rest out
const FIT = [byName("F4"), byName("A4"), byName("C5"), byName("F5"), byName("A5"), byName("C6")];
const HOLD = [byName("F6"), byName("A5", 1), byName("C6", 1), byName("A3"), byName("F3")];

const VIB = { vibratoRate: 3.3, vibratoDepth: 40, vibratoDelay: 0, jitter: 0 }; // as measured, so smearing is comparable

function dist(r, s) {
  let hs = 0, hc = 0;
  for (let i = 0; i < Math.min(r.harm.length, s.harm.length); i++) if (r.harm[i].f < 8000) { hs += Math.abs(r.harm[i].db - s.harm[i].db); hc++; }
  const bd = r.bands.reduce((a, v, i) => a + Math.abs(v - s.bands[i]), 0) / r.bands.length;
  return { harm: hs / hc, band: bd, total: hs / hc + 0.5 * bd };
}

// parameter space: name -> [lo, hi, get(p), set(p, v)]
// the fit is written to the tweaks of あ only (the clips analysed so far hold あ), so the other vowels keep their natural formants
const T = (i, k) => [(p) => p.vowelTweaks.a[i][k], (p, v) => (p.vowelTweaks.a[i][k] = v)];
const SPACE = {
  pulseWidth: [0.1, 0.5, (p) => p.pulseWidth, (p, v) => (p.pulseWidth = v)],
  saw: [0, 0.8, (p) => p.saw, (p, v) => (p.saw = v)],
  sine: [0, 0.8, (p) => p.sine, (p, v) => (p.sine = v)],
  brightness: [0.2, 1, (p) => p.brightness, (p, v) => (p.brightness = v)],
  breath: [0, 0.4, (p) => p.breath, (p, v) => (p.breath = v)],
  tracking: [0, 1, (p) => p.tracking, (p, v) => (p.tracking = v)],
  F1freq: [0.85, 1.15, ...T(0, "freq")],
  F2freq: [0.85, 1.6, ...T(1, "freq")],
  F2bw: [0.6, 2, ...T(1, "bw")],
  F3freq: [0.85, 1.2, ...T(2, "freq")],
  F3gain: [0, 1.6, ...T(2, "gain")],
  F4gain: [0, 1.6, ...T(3, "gain")],
  F5gain: [0, 1.6, ...T(4, "gain")],
};

const base = { ...(await synth.builtin("bright")), ...VIB, vowelPos: 0.5 }; // start from Bright Vocal with matched vibrato, vowel あ
const evals = { n: 0 };
async function score(p, notes, detail = false) {
  const rows = [];
  for (const r of notes) {
    const x = await synth.render({ f0: r.f0, y: 0.5, axis: "fixed", dur: 1.7, base: p });
    const s = noteFeatures(x, sr, r.f0, Math.round(0.35 * sr), Math.round(1.6 * sr), false);
    rows.push(dist(r, s));
  }
  evals.n++;
  const mean = (k) => rows.reduce((a, d) => a + d[k], 0) / rows.length;
  return detail ? { harm: mean("harm"), band: mean("band"), total: mean("total"), rows } : mean("total");
}

const clone = (p) => JSON.parse(JSON.stringify(p));
const before = await score(base, FIT, true);
const beforeHold = await score(base, HOLD, true);
console.log(`start  fit total ${before.total.toFixed(2)} (harm ${before.harm.toFixed(1)}, band ${before.band.toFixed(1)})   holdout total ${beforeHold.total.toFixed(2)}`);

let best = clone(base), bestScore = before.total;
for (const frac of [0.2, 0.1, 0.05]) {
  for (const [name, [lo, hi, get, set]] of Object.entries(SPACE)) {
    for (const dir of [+1, -1]) {
      const cand = clone(best);
      const v = Math.min(hi, Math.max(lo, get(cand) + dir * frac * (hi - lo)));
      if (v === get(cand)) continue;
      set(cand, v);
      const sc = await score(cand, FIT);
      if (sc < bestScore - 0.02) { best = cand; bestScore = sc; console.log(`  step ${frac}: ${name} -> ${v.toFixed(3)}  total ${sc.toFixed(2)}`); break; }
    }
  }
  console.log(`after pass @${frac}: ${bestScore.toFixed(2)}  (${evals.n} evals)`);
}

const after = await score(best, FIT, true);
const afterHold = await score(best, HOLD, true);
console.log(`\nFIT      before ${before.total.toFixed(2)} -> after ${after.total.toFixed(2)}   (harmonic ${before.harm.toFixed(1)} -> ${after.harm.toFixed(1)} dB, band ${before.band.toFixed(1)} -> ${after.band.toFixed(1)} dB)`);
console.log(`HOLDOUT  before ${beforeHold.total.toFixed(2)} -> after ${afterHold.total.toFixed(2)}`);
console.log("\nper note (total distance before -> after):");
FIT.forEach((r, i) => console.log(`  fit   ${r.name.padEnd(3)} ${before.rows[i].total.toFixed(1)} -> ${after.rows[i].total.toFixed(1)}`));
HOLD.forEach((r, i) => console.log(`  hold  ${r.name.padEnd(3)} ${beforeHold.rows[i].total.toFixed(1)} -> ${afterHold.rows[i].total.toFixed(1)}`));
console.log("\nFITTED PARAMS:\n" + JSON.stringify(Object.fromEntries(Object.entries(SPACE).map(([k, [, , get]]) => [k, +get(best).toFixed(3)]))));
fs.writeFileSync(`${SP}/fit-result.json`, JSON.stringify(best));
synth.close();
process.exit(0);
