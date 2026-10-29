import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FORMANT_COUNT,
  FORMANT_LIMITS,
  MAX_Q,
  MORPH_ORDER,
  VOWELS,
  VOWEL_ORDER,
  clampTweak,
  formantQ,
  formantScale,
  identityTweaks,
  makeFormants,
  morphInto,
  nearestVowel,
  tweakInto,
  vowelLabel,
  vowelPosition,
} from "./formants.ts";

test("five Japanese vowels, each with five ordered, in-range resonances", () => {
  assert.deepEqual([...VOWEL_ORDER].map((id) => VOWELS[id].kana), ["あ", "い", "う", "え", "お"]);
  for (const id of VOWEL_ORDER) {
    const f = VOWELS[id].formants;
    assert.equal(f.length, FORMANT_COUNT);
    for (let i = 0; i < f.length; i++) {
      assert.ok(f[i].freq >= FORMANT_LIMITS.freq[0] && f[i].freq <= FORMANT_LIMITS.freq[1], `${id} F${i + 1} freq`);
      assert.ok(f[i].bw >= FORMANT_LIMITS.bw[0] && f[i].bw <= FORMANT_LIMITS.bw[1], `${id} F${i + 1} bw`);
      assert.ok(f[i].gain >= 0 && f[i].gain <= FORMANT_LIMITS.gain[1]);
      if (i > 0) assert.ok(f[i].freq > f[i - 1].freq, `${id}: F${i + 1} must be above F${i}`);
    }
  }
});

test("the vowels are acoustically distinct where it matters (F1/F2)", () => {
  const f = (id: "a" | "i" | "u" | "e" | "o") => VOWELS[id].formants;
  assert.ok(f("a")[0].freq > f("i")[0].freq + 300); // open vs close
  assert.ok(f("i")[1].freq > f("u")[1].freq + 800); // front vs back
  assert.ok(f("e")[1].freq > f("o")[1].freq + 800);
  assert.ok(f("o")[0].freq > f("u")[0].freq); // mid vs close
});

test("morph axis maps vowels to evenly spaced positions and back", () => {
  assert.deepEqual([...MORPH_ORDER], ["u", "o", "a", "e", "i"]);
  assert.equal(vowelPosition("u"), 0);
  assert.equal(vowelPosition("i"), 1);
  for (const id of VOWEL_ORDER) assert.equal(nearestVowel(vowelPosition(id)), id);
  assert.equal(vowelLabel(vowelPosition("a")), "あ");
  assert.equal(vowelLabel(0.375), "お→あ"); // halfway between お and あ
});

test("interpolation is exact at every vowel endpoint", () => {
  const out = makeFormants();
  for (const id of VOWEL_ORDER) {
    morphInto(out, vowelPosition(id));
    VOWELS[id].formants.forEach((want, i) => {
      assert.ok(Math.abs(out[i].freq - want.freq) < 1e-6, `${id} F${i + 1} freq`);
      assert.ok(Math.abs(out[i].bw - want.bw) < 1e-6);
      assert.ok(Math.abs(out[i].gain - want.gain) < 1e-9);
    });
  }
});

test("midpoints lie between neighbours (geometric mean for frequency)", () => {
  const out = makeFormants();
  morphInto(out, 0.125); // halfway between う (0) and お (0.25)
  const u = VOWELS.u.formants;
  const o = VOWELS.o.formants;
  for (let i = 0; i < FORMANT_COUNT; i++) {
    assert.ok(Math.abs(out[i].freq - Math.sqrt(u[i].freq * o[i].freq)) < 1e-6);
    assert.ok(Math.abs(out[i].gain - (u[i].gain + o[i].gain) / 2) < 1e-9);
  }
});

test("a full sweep is continuous: no step jumps by more than a small fraction", () => {
  const a = makeFormants();
  const b = makeFormants();
  const steps = 400;
  morphInto(a, 0);
  for (let s = 1; s <= steps; s++) {
    morphInto(b, s / steps);
    for (let i = 0; i < FORMANT_COUNT; i++) {
      assert.ok(Math.abs(b[i].freq / a[i].freq - 1) < 0.02, `F${i + 1} jumped at step ${s}`);
      assert.ok(Math.abs(b[i].gain - a[i].gain) < 0.01);
    }
    for (let i = 0; i < FORMANT_COUNT; i++) Object.assign(a[i], b[i]);
  }
});

test("out-of-range positions clamp to the end vowels", () => {
  const lo = makeFormants();
  const hi = makeFormants();
  morphInto(lo, -3);
  morphInto(hi, 9);
  assert.equal(Math.round(lo[0].freq), VOWELS.u.formants[0].freq);
  assert.equal(Math.round(hi[0].freq), VOWELS.i.formants[0].freq);
});

test("pitch does not move the formants unless tracking is enabled", () => {
  assert.equal(formantScale(110, 0), 1);
  assert.equal(formantScale(880, 0), 1);
  assert.ok(formantScale(880, 1) > formantScale(110, 1));
  for (const f0 of [20, 110, 440, 4000, 20000]) {
    const s = formantScale(f0, 1);
    assert.ok(s >= 0.8 && s <= 1.4, `scale ${s} out of bounds at ${f0} Hz`);
  }
});

test("tweaks are applied, then everything is clamped to safe bounds", () => {
  const out = makeFormants();
  morphInto(out, vowelPosition("a"));
  const base = out.map((f) => ({ ...f }));
  const tweaks = identityTweaks();
  tweaks[1] = { freq: 1.2, bw: 2, gain: 0.5 };
  tweakInto(out, tweaks, 1);
  assert.ok(Math.abs(out[1].freq - base[1].freq * 1.2) < 1e-9);
  assert.ok(Math.abs(out[1].bw - base[1].bw * 2) < 1e-9);
  assert.ok(Math.abs(out[1].gain - base[1].gain * 0.5) < 1e-9);
  assert.equal(out[0].freq, base[0].freq); // untouched resonance unchanged

  // absurd values still land in range
  morphInto(out, 0.5);
  const wild = identityTweaks().map(() => ({ freq: 1000, bw: 1000, gain: 1000 }));
  tweakInto(out, wild, 5);
  for (const f of out) {
    assert.ok(f.freq <= FORMANT_LIMITS.freq[1] && f.bw <= FORMANT_LIMITS.bw[1] && f.gain <= FORMANT_LIMITS.gain[1]);
  }
  morphInto(out, 0.5);
  tweakInto(out, identityTweaks().map(() => ({ freq: 0, bw: 0, gain: -4 })), 0);
  for (const f of out) {
    assert.ok(f.freq >= FORMANT_LIMITS.freq[0] && f.bw >= FORMANT_LIMITS.bw[0] && f.gain >= 0);
  }
});

test("tweak values from outside are sanitised", () => {
  assert.deepEqual(clampTweak(undefined), { freq: 1, bw: 1, gain: 1 });
  const t = clampTweak({ freq: Number.NaN, bw: 99, gain: -1 });
  assert.equal(t.freq, 1);
  assert.equal(t.bw, 3);
  assert.equal(t.gain, 0);
});

test("filter Q is bounded so narrow resonances cannot run away", () => {
  assert.equal(formantQ(1000, 100), 10);
  assert.equal(formantQ(9000, 30), MAX_Q);
  assert.ok(Number.isFinite(formantQ(1000, 0)));
});

