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
  formantsInto,
  identityTweaks,
  identityVowelTweaks,
  makeFormants,
  morphInto,
  nearestVowel,
  shapeVowelPos,
  tweakInto,
  vowelLabel,
  vowelPosition,
  vowelTweaksAt,
} from "./formants.ts";
import { BUILTIN_VOCAL } from "./params.ts";

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
  assert.deepEqual([...MORPH_ORDER], ["a", "i", "u", "e", "o"]); // bottom to top: あ い う え お
  assert.equal(vowelPosition("a"), 0);
  assert.equal(vowelPosition("o"), 1);
  for (const id of VOWEL_ORDER) assert.equal(nearestVowel(vowelPosition(id)), id);
  assert.equal(vowelLabel(vowelPosition("a")), "あ");
  assert.equal(vowelLabel(0.125), "あ→い"); // halfway between あ and い
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
  morphInto(out, 0.125); // halfway between あ (0) and い (0.25)
  const a = VOWELS.a.formants;
  const i2 = VOWELS.i.formants;
  for (let i = 0; i < FORMANT_COUNT; i++) {
    assert.ok(Math.abs(out[i].freq - Math.sqrt(a[i].freq * i2[i].freq)) < 1e-6);
    assert.ok(Math.abs(out[i].gain - (a[i].gain + i2[i].gain) / 2) < 1e-9);
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
      assert.ok(Math.abs(b[i].gain - a[i].gain) < 0.02);
    }
    for (let i = 0; i < FORMANT_COUNT; i++) Object.assign(a[i], b[i]);
  }
});

test("out-of-range positions clamp to the end vowels", () => {
  const lo = makeFormants();
  const hi = makeFormants();
  morphInto(lo, -3);
  morphInto(hi, 9);
  assert.equal(Math.round(lo[0].freq), VOWELS.a.formants[0].freq);
  assert.equal(Math.round(hi[0].freq), VOWELS.o.formants[0].freq);
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

test("front vowels carry more upper-formant energy than back vowels (so the sweep changes brightness, not just F1)", () => {
  const upper = (id: "a" | "i" | "u" | "e" | "o") => VOWELS[id].formants[1].gain + VOWELS[id].formants[2].gain;
  assert.ok(upper("i") > upper("e") && upper("e") > upper("a"), "い > え > あ");
  assert.ok(upper("a") > upper("o") && upper("o") > upper("u"), "あ > お > う");
});

test("vowel hold: vowels map to themselves, the slide is monotonic, and pure vowels get wide flat zones", () => {
  for (const h of [0, 0.3, 0.7, 1]) {
    assert.equal(shapeVowelPos(0, h), 0);
    assert.equal(shapeVowelPos(1, h), 1);
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const v = shapeVowelPos(p, h);
      assert.ok(v >= last - 1e-12, `not monotonic at ${p} (hold ${h})`);
      last = v;
    }
    for (const id of VOWEL_ORDER) assert.ok(Math.abs(shapeVowelPos(vowelPosition(id), h) - vowelPosition(id)) < 1e-9);
    assert.ok(Math.abs(shapeVowelPos(0.125, h) - 0.125) < 1e-9, "halfway between two vowels stays halfway");
  }
  assert.equal(shapeVowelPos(0.37, 0), 0.37); // hold 0 = the plain linear slide
  // with hold 0.7, the finger can wander +-0.04 around あ (a fifth of its span) and the vowel moves under 0.5% of a span
  const a = vowelPosition("a");
  assert.ok(Math.abs(shapeVowelPos(a + 0.04, 0.7) - a) < 0.005 / 4 * 4);
  assert.ok(Math.abs(shapeVowelPos(a - 0.04, 0.7) - a) < 0.005);
  // out-of-range input is clamped
  assert.equal(shapeVowelPos(-3, 0.5), 0);
  assert.equal(shapeVowelPos(9, 0.5), 1);
});

test("per-vowel tweaks apply fully at their vowel and fade out towards the neighbours", () => {
  const vt = identityVowelTweaks();
  vt.a[2] = { freq: 1, bw: 1, gain: 0.1 };
  const out = identityTweaks();
  vowelTweaksAt(out, vt, vowelPosition("a"));
  assert.ok(Math.abs(out[2].gain - 0.1) < 1e-9, "full effect on あ");
  vowelTweaksAt(out, vt, (vowelPosition("a") + vowelPosition("i")) / 2);
  assert.ok(Math.abs(out[2].gain - 0.55) < 1e-9, "half way to い: halfway between 0.1 and 1");
  for (const id of ["u", "e"] as const) {
    vowelTweaksAt(out, vt, vowelPosition(id));
    assert.deepEqual(out[2], { freq: 1, bw: 1, gain: 1 }, `no effect on ${id}`);
  }
});

test("formantsInto with identity tweaks equals the plain vowel, at every position", () => {
  const plain = makeFormants();
  const full = makeFormants();
  for (let p = 0; p <= 1.0001; p += 0.1) {
    morphInto(plain, p);
    formantsInto(full, p, identityTweaks(), identityVowelTweaks(), 1);
    for (let i = 0; i < FORMANT_COUNT; i++) {
      assert.ok(Math.abs(full[i].freq - plain[i].freq) < 1e-9 && Math.abs(full[i].gain - plain[i].gain) < 1e-9);
    }
  }
});

test("a per-vowel edit on あ changes あ and leaves い exactly as it was", () => {
  const vt = identityVowelTweaks();
  vt.a[2] = { freq: 1.2, bw: 2, gain: 0.1 };
  const natural = makeFormants();
  const edited = makeFormants();
  formantsInto(natural, vowelPosition("i"), identityTweaks(), identityVowelTweaks(), 1);
  formantsInto(edited, vowelPosition("i"), identityTweaks(), vt, 1);
  assert.deepEqual(edited, natural);
  formantsInto(natural, vowelPosition("a"), identityTweaks(), identityVowelTweaks(), 1);
  formantsInto(edited, vowelPosition("a"), identityTweaks(), vt, 1);
  assert.notDeepEqual(edited[2], natural[2]);
  assert.ok(Math.abs(edited[2].freq - natural[2].freq * 1.2) < 1e-6);
});

test("the reference-fitted あ is exactly the fitted one (F1 862.75 Hz, F2 1390.5 Hz, F2 bandwidth 253 Hz)", () => {
  const a = makeFormants();
  const m = BUILTIN_VOCAL.miku.params;
  formantsInto(a, vowelPosition("a"), m.tweaks, m.vowelTweaks, 1);
  assert.ok(Math.abs(a[0].freq - 850 * 1.015) < 1e-6);
  assert.ok(Math.abs(a[1].freq - 1350 * 1.03) < 1e-6);
  assert.ok(Math.abs(a[1].bw - 170 * 1.49) < 1e-6);
  assert.ok(Math.abs(a[2].gain - 0.45 * 0.15) < 1e-9);
  assert.ok(Math.abs(a[3].gain - 0.28 * 0.6) < 1e-9);
});

test("filter Q is bounded so narrow resonances cannot run away", () => {
  assert.equal(formantQ(1000, 100), 10);
  assert.equal(formantQ(9000, 30), MAX_Q);
  assert.ok(Number.isFinite(formantQ(1000, 0)));
});

