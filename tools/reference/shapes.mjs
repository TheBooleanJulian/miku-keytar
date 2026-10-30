// Prints each vowel's rendered harmonic envelope, so you can see formant peaks and valleys as numbers.
//
//   node tools/reference/shapes.mjs [workdir] [preset] [f0 in Hz]      (needs `npm run dev`)
import { startSynth } from "./synth.mjs";
import { noteFeatures } from "./features.mjs";

const work = process.argv[2] ?? "ref/.analysis";
const preset = process.argv[3] ?? "miku";
const f0 = Number(process.argv[4] ?? 262);
const synth = await startSynth(work);
const params = await synth.builtin(preset);
const ks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16].filter((k) => k * f0 <= 5000);
console.log(`${preset} at ${f0} Hz: harmonic level in dB relative to the strongest harmonic`);
console.log("harmonic  " + ks.map((k) => String(k).padStart(5)).join(""));
console.log("Hz        " + ks.map((k) => String(Math.round(k * f0)).padStart(5)).join(""));
for (const [name, pos] of [["u", 0], ["o", 0.25], ["a", 0.5], ["e", 0.75], ["i", 1]]) {
  const x = await synth.render({ f0, y: 0.5, axis: "fixed", dur: 1.9, base: { ...params, vowelPos: pos } });
  const f = noteFeatures(x, synth.sr, f0, Math.round(0.4 * synth.sr), Math.round(1.8 * synth.sr), false);
  console.log(`  ${name}       ` + ks.map((k) => (f.harm[k - 1] ? f.harm[k - 1].db.toFixed(0) : "  -").padStart(5)).join(""));
}
synth.close();
process.exit(0);
