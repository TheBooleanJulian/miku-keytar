import assert from "node:assert/strict";
import { test } from "node:test";
import { FORMANT_COUNT, formantScale, makeFormants, morphInto, tweakInto } from "./formants.ts";
import {
  BUILTIN_VOCAL,
  BUILTIN_VOCAL_IDS,
  VOCAL_LIMITS,
  brightnessToCutoff,
  cloneVocal,
  defaultVocal,
  effectiveBrightness,
  effectiveVowelPos,
  pulseWaveCoeffs,
  sanitizeVocal,
} from "./params.ts";

test("the three original presets plus the reference-fitted one ship, each within every bound", () => {
  assert.deepEqual([...BUILTIN_VOCAL_IDS].sort(), ["bright", "electronic", "miku", "soft"]);
  for (const id of BUILTIN_VOCAL_IDS) {
    const p = BUILTIN_VOCAL[id].params;
    for (const [key, [lo, hi]] of Object.entries(VOCAL_LIMITS)) {
      const v = (p as unknown as Record<string, number>)[key];
      assert.ok(v >= lo && v <= hi, `${id}.${key}=${v} outside [${lo}, ${hi}]`);
    }
    assert.equal(p.tweaks.length, FORMANT_COUNT);
  }
});

test("the presets really differ in character", () => {
  const { bright, soft, electronic } = BUILTIN_VOCAL;
  assert.ok(electronic.params.brightness > bright.params.brightness);
  assert.ok(bright.params.brightness > soft.params.brightness);
  assert.ok(electronic.params.pulseWidth < soft.params.pulseWidth); // narrower pulse = more harmonics
  assert.ok(soft.params.attack > bright.params.attack);
});

test("the reference-fitted preset encodes what was measured, and leaves the other presets alone", () => {
  const miku = BUILTIN_VOCAL.miku.params;
  const bright = BUILTIN_VOCAL.bright.params;
  // measured on the reference: 3.3 Hz vibrato about +-40 cents; much less energy around 3 kHz; some breath
  assert.ok(miku.vibratoRate >= 3 && miku.vibratoRate <= 3.6);
  assert.ok(miku.vibratoDepth >= 30 && miku.vibratoDepth <= 45);
  assert.ok(miku.tweaks[2].gain < bright.tweaks[2].gain / 2, "F3 (2.8 kHz) must be well below Bright Vocal's");
  assert.ok(miku.tweaks[1].bw > 1.2, "broader second formant");
  assert.ok(miku.breath > bright.breath);
  // the older presets are unchanged
  assert.equal(bright.vibratoRate, 5.4);
  assert.equal(bright.vibratoDepth, 14);
  assert.equal(bright.tweaks[2].gain, 1.35);
});

test("sanitising clamps bad values, ignores junk and never throws", () => {
  const p = sanitizeVocal({ brightness: 7, breath: -3, vibratoRate: "fast", release: Number.NaN, pulseWidth: 0.9 });
  assert.equal(p.brightness, 1);
  assert.equal(p.breath, 0);
  assert.equal(p.vibratoRate, defaultVocal().vibratoRate); // wrong type -> default
  assert.equal(p.release, defaultVocal().release); // NaN -> default
  assert.equal(p.pulseWidth, 0.5);
  for (const junk of [null, undefined, 42, "x", [], { tweaks: "no" }]) {
    const q = sanitizeVocal(junk);
    assert.equal(q.tweaks.length, FORMANT_COUNT);
  }
});

test("sanitising keeps valid edits and does not mutate its base", () => {
  const base = defaultVocal();
  const copy = cloneVocal(base);
  const p = sanitizeVocal({ brightness: 0.25, tweaks: [{ freq: 1.1, bw: 1, gain: 1 }] }, base);
  assert.equal(p.brightness, 0.25);
  assert.equal(p.tweaks[0].freq, 1.1);
  assert.equal(p.tweaks[1].freq, base.tweaks[1].freq); // missing entries fall back to the base
  assert.deepEqual(base, copy);
});

test("pulse spectrum: a square has only odd harmonics falling as 1/n", () => {
  const { real, imag } = pulseWaveCoeffs(0.5);
  const mag = (n: number) => Math.hypot(real[n], imag[n]);
  assert.equal(real[0], 0);
  assert.equal(imag[0], 0);
  for (const n of [2, 4, 6, 8, 20]) assert.ok(mag(n) < 1e-6, `harmonic ${n} should vanish`);
  assert.ok(Math.abs(mag(1) - 2 / Math.PI) < 1e-6); // unit-amplitude (0..1) pulse train
  assert.ok(Math.abs(mag(3) - 2 / (3 * Math.PI)) < 1e-6);
  assert.ok(Math.abs(mag(5) - 2 / (5 * Math.PI)) < 1e-6);
});

test("a narrower pulse carries relatively more high-harmonic energy", () => {
  const share = (w: number) => {
    const { real, imag } = pulseWaveCoeffs(w);
    let high = 0;
    let all = 0;
    for (let n = 1; n < real.length; n++) {
      const e = real[n] ** 2 + imag[n] ** 2;
      all += e;
      if (n >= 8) high += e;
    }
    return high / all;
  };
  assert.ok(share(0.1) > share(0.5));
  assert.ok(share(0.1) > share(0.25));
});

test("pulse width input is clamped", () => {
  const a = pulseWaveCoeffs(-1);
  const b = pulseWaveCoeffs(0.05);
  assert.deepEqual(Array.from(a.real), Array.from(b.real));
});

test("brightness maps logarithmically into a usable cutoff range", () => {
  assert.ok(Math.abs(brightnessToCutoff(0) - 1500) < 1e-9);
  assert.ok(Math.abs(brightnessToCutoff(1) - 12000) < 1e-6);
  assert.ok(Math.abs(brightnessToCutoff(0.5) - Math.sqrt(1500 * 12000)) < 1e-6);
  assert.equal(brightnessToCutoff(-4), brightnessToCutoff(0));
});

test("vertical axis: morph mode moves the vowel, fixed mode moves brightness", () => {
  // morph: vowel follows the finger, brightness stays at the panel value
  assert.equal(effectiveVowelPos(0.5, 0.9, "morph"), 0.9);
  assert.equal(effectiveBrightness(0.6, 0.9, "morph"), 0.6);
  // fixed: vowel stays at the panel value, brightness follows the finger around the panel value
  assert.equal(effectiveVowelPos(0.5, 0.9, "fixed"), 0.5);
  assert.equal(effectiveBrightness(0.6, 0.5, "fixed"), 0.6);
  assert.ok(effectiveBrightness(0.6, 1, "fixed") > effectiveBrightness(0.6, 0, "fixed"));
  assert.equal(effectiveBrightness(0.95, 1, "fixed"), 1);
});

test("pitch and vowel are independent: the same vowel gives the same formants at any pitch", () => {
  const p = defaultVocal();
  p.tracking = 0;
  const at = (f0: number) => {
    const out = makeFormants();
    morphInto(out, 0.6);
    tweakInto(out, p.tweaks, formantScale(f0, p.tracking));
    return out.map((f) => [f.freq, f.bw, f.gain]);
  };
  assert.deepEqual(at(110), at(880));
  assert.deepEqual(at(220), at(1760));
  // ...and the vowel changes the formants without any pitch input
  const a = makeFormants();
  const b = makeFormants();
  morphInto(a, 0.2);
  morphInto(b, 0.9);
  assert.notDeepEqual(a, b);
});
