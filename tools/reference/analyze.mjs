// Measures a reference recording of sustained notes: pitch range, steady notes, spectral balance per note,
// vibrato (rate, depth) and breathiness cues. Local only; nothing is uploaded.
//
//   node tools/reference/analyze.mjs <audio file> [workdir]        (workdir defaults to ref/.analysis, which is git-ignored)
//
// Needs ffmpeg on the PATH to decode the file. Writes <workdir>/ref.wav and <workdir>/ref-features.json.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readWav, trackPitch, segmentNotes, noteName, midiOf, hzOf, medianOf, db } from "./dsp.mjs";
import { BANDS, noteFeatures } from "./features.mjs";

const input = process.argv[2];
const work = process.argv[3] ?? path.join("ref", ".analysis");
if (!input) {
  console.error("usage: node tools/reference/analyze.mjs <audio file> [workdir]");
  process.exit(1);
}
fs.mkdirSync(work, { recursive: true });
const wav = path.join(work, "ref.wav");
const dec = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav], { encoding: "utf8" });
if (dec.status !== 0) {
  console.error("ffmpeg could not decode the file:\n" + (dec.stderr || dec.error));
  process.exit(1);
}

const { x, sr } = readWav(wav);
const { frames } = trackPitch(x, sr);
const voiced = frames.filter((f) => f.voiced);
const f0s = voiced.map((f) => f.f0).sort((a, b) => a - b);
console.log(`${(x.length / sr).toFixed(1)} s, ${voiced.length} of ${frames.length} frames voiced`);
console.log(`pitch range (5th-95th percentile): ${noteName(midiOf(f0s[Math.floor(f0s.length * 0.05)]))} to ${noteName(midiOf(f0s[Math.floor(f0s.length * 0.95)]))}`);

const notes = segmentNotes(frames, 1.2); // steady notes only
if (notes.length === 0) {
  console.error("No steady notes of 1.2 s or longer were found; this tool is meant for sustained-note recordings.");
  process.exit(1);
}
const feats = notes.map((s) => {
  const f0 = medianOf(s.frames.map((f) => f.f0));
  const from = Math.round((s.start + 0.35) * sr);
  const to = Math.round((s.start + s.dur - 0.2) * sr);
  return { name: noteName(midiOf(f0)), start: +s.start.toFixed(2), ...noteFeatures(x, sr, f0, from, to) };
});
fs.writeFileSync(path.join(work, "ref-features.json"), JSON.stringify(feats));

console.log(`\n${feats.length} steady notes. Band energy relative to the total (dB):`);
console.log("note     f0  " + BANDS.map(([a, b]) => `${a}-${b}`.padStart(9)).join(""));
for (const f of feats) console.log(`${f.name.padEnd(4)} ${f.f0.toFixed(0).padStart(6)}  ` + f.bands.map((v) => v.toFixed(1).padStart(9)).join(""));
console.log("\nnote   vibrato rate   depth (+-cents)   pitch wander sd   level (dBFS)");
for (const f of feats)
  console.log(
    `${f.name.padEnd(4)} ` +
      (f.vib ? `${f.vib.rate.toFixed(1).padStart(8)} Hz  ${f.vib.depth.toFixed(0).padStart(10)}  ${f.vib.sd.toFixed(0).padStart(15)}` : "     n/a") +
      `   ${f.rmsDb.toFixed(0).padStart(10)}`,
  );
console.log(`\nSaved ${path.join(work, "ref-features.json")}. Next: node tools/reference/fit.mjs ${work}  (needs 'npm run dev' running and Edge/Chrome)`);
