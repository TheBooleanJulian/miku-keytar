import assert from "node:assert/strict";
import { test } from "node:test";
import { VOWEL_ORDER, VOWELS, formantScale, makeFormants, morphInto, tweakInto, vowelPosition } from "./formants.ts";
import { LEVEL_TARGET, MAX_LEVEL_GAIN, MIN_LEVEL_GAIN, levelGain, predictedLevel } from "./level.ts";
import { midiToFreq } from "../pitchmap.ts";
import { defaultVocal } from "./params.ts";

const NOTES = [48, 52, 55, 60, 64, 67, 72, 76];

function formantsAt(pos: number, f0: number, p = defaultVocal()) {
  const fm = makeFormants();
  morphInto(fm, pos);
  tweakInto(fm, p.tweaks, formantScale(f0, p.tracking));
  return fm;
}

test("predicted level is finite and positive for every vowel and pitch", () => {
  const p = defaultVocal();
  for (const id of VOWEL_ORDER) {
    for (const note of NOTES) {
      const f0 = midiToFreq(note);
      const v = predictedLevel(f0, formantsAt(vowelPosition(id), f0, p), p, p.brightness);
      assert.ok(Number.isFinite(v) && v > 0, `${VOWELS[id].kana} @ ${note}: ${v}`);
    }
  }
});

test("without compensation loudness would swing a lot with pitch (why the compensation exists)", () => {
  const p = defaultVocal();
  let worst = 1;
  for (const id of VOWEL_ORDER) {
    const levels = NOTES.map((n) => {
      const f0 = midiToFreq(n);
      return predictedLevel(f0, formantsAt(vowelPosition(id), f0, p), p, p.brightness);
    });
    worst = Math.max(worst, Math.max(...levels) / Math.min(...levels));
  }
  assert.ok(worst > 1.8, `uncompensated spread was only ${worst.toFixed(2)}x`);
});

test("with compensation the predicted output sits on the target for every vowel and pitch", () => {
  const p = defaultVocal();
  for (const id of VOWEL_ORDER) {
    for (const note of NOTES) {
      const f0 = midiToFreq(note);
      const fm = formantsAt(vowelPosition(id), f0, p);
      const out = predictedLevel(f0, fm, p, p.brightness) * levelGain(f0, fm, p, p.brightness);
      assert.ok(Math.abs(out - LEVEL_TARGET) < 1e-9, `${id} @ ${note}: ${out}`);
    }
  }
});

test("pitch and vowel remain independent: compensation changes gain, never the formants", () => {
  const p = defaultVocal();
  p.tracking = 0;
  const a = formantsAt(0.5, 130, p).map((f) => ({ ...f }));
  const b = formantsAt(0.5, 1000, p).map((f) => ({ ...f }));
  assert.deepEqual(a, b);
  levelGain(130, a, p, p.brightness);
  levelGain(1000, b, p, p.brightness);
  assert.deepEqual(a, b, "levelGain must not mutate the formants");
});

test("turning every formant up halves the compensating gain; muting them all hits the safety ceiling", () => {
  const p = defaultVocal();
  const f0 = 262;
  const fm = formantsAt(0.5, f0, p);
  const g1 = levelGain(f0, fm, p, 0.7);
  const loud = fm.map((f) => ({ ...f, gain: f.gain * 2 }));
  const g2 = levelGain(f0, loud, p, 0.7);
  assert.ok(Math.abs(g2 / g1 - 0.5) < 1e-6, `${g2 / g1}`);
  const mute = fm.map((f) => ({ ...f, gain: 0 }));
  assert.equal(levelGain(f0, mute, p, 0.7), MAX_LEVEL_GAIN);
});

test("compensation stays inside its safety limits for hostile settings", () => {
  const p = { ...defaultVocal(), pulse: 0, saw: 0, sine: 0, breath: 1 };
  const fm = formantsAt(0.5, 262, p);
  const g = levelGain(262, fm, p, 1);
  assert.ok(g >= MIN_LEVEL_GAIN && g <= MAX_LEVEL_GAIN && Number.isFinite(g));
  const loud = { ...defaultVocal(), pulse: 1, saw: 1, sine: 1 };
  const g2 = levelGain(262, formantsAt(0.5, 262, loud), loud, 1);
  assert.ok(g2 >= MIN_LEVEL_GAIN && g2 <= MAX_LEVEL_GAIN);
});

test("a brighter excitation predicts more energy, so it is turned down to match", () => {
  const p = defaultVocal();
  const fm = formantsAt(0.5, 262, p);
  assert.ok(predictedLevel(262, fm, p, 1) > predictedLevel(262, fm, p, 0));
  assert.ok(levelGain(262, fm, p, 1) < levelGain(262, fm, p, 0));
});
