// How close is a preset to the analysed reference? Renders the engine at the reference's own pitches (vowel あ, matched
// vibrato) and compares harmonic levels and band balance. Lower is closer; only compare numbers from the same recording.
//
//   node tools/reference/distance.mjs [workdir] [preset] ['{"breath":0.1}']      (needs `npm run dev` and analyze.mjs first)
import fs from "node:fs";
import path from "node:path";
import { startSynth } from "./synth.mjs";
import { noteFeatures, BANDS } from "./features.mjs";

const work = process.argv[2] ?? path.join("ref", ".analysis");
const preset = process.argv[3] ?? "miku";
const patch = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const ref = JSON.parse(fs.readFileSync(path.join(work, "ref-features.json"), "utf8"));
const pick = (name, i = 0) => ref.filter((r) => r.name === name)[i];
const FIT = ["F4", "A4", "C5", "F5", "A5", "C6"].map((n) => pick(n)).filter(Boolean); // the steady, あ-like range
const HOLD = [pick("F6"), pick("A3")].filter(Boolean);

function dist(r, s) {
  let hs = 0, hc = 0;
  for (let i = 0; i < Math.min(r.harm.length, s.harm.length); i++) if (r.harm[i].f < 8000) { hs += Math.abs(r.harm[i].db - s.harm[i].db); hc++; }
  // the lowest band holds room noise above 300 Hz, not the voice
  const idx = BANDS.map((_, i) => i).filter((i) => !(i === 0 && r.f0 > 300));
  const band = idx.reduce((a, i) => a + Math.abs(r.bands[i] - s.bands[i]), 0) / idx.length;
  return { harm: hs / hc, band, total: hs / hc + 0.5 * band };
}

const synth = await startSynth(work);
const params = { ...(await synth.builtin(preset)), vowelPos: 0.5, ...patch };
// match the reference's measured vibrato so the harmonic smearing is comparable
params.vibratoRate = 3.3; params.vibratoDepth = 40; params.vibratoDelay = 0; params.jitter = 0;

async function run(notes) {
  const rows = [];
  for (const r of notes) {
    const x = await synth.render({ f0: r.f0, y: 0.5, axis: "fixed", dur: 1.7, base: params });
    rows.push(dist(r, noteFeatures(x, synth.sr, r.f0, Math.round(0.35 * synth.sr), Math.round(1.6 * synth.sr), false)));
  }
  const m = (k) => rows.reduce((a, d) => a + d[k], 0) / rows.length;
  return `${m("harm").toFixed(1)} / ${m("band").toFixed(1)} / ${m("total").toFixed(1)}`;
}
console.log(`${preset}${process.argv[4] ? " " + process.argv[4] : ""}: distance to reference (harmonic dB / band dB / total)`);
console.log(`  steady range ${FIT.map((r) => r.name).join(" ")}: ${await run(FIT)}`);
if (HOLD.length) console.log(`  held-out ${HOLD.map((r) => r.name).join(" ")}: ${await run(HOLD)}`);
synth.close();
process.exit(0);
