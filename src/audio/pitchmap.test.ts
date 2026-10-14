import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLayout, midiToFreq, midiToName, midiToX, xToMidi } from "./pitchmap.ts";
import { PRESETS, cutoffHz } from "./presets.ts";

test("layout note counts for two octaves", () => {
  assert.equal(buildLayout(0, 3, 2, "chromatic").notes.length, 25);
  assert.equal(buildLayout(0, 3, 2, "major").notes.length, 15);
  assert.equal(buildLayout(0, 3, 2, "minor").notes.length, 15);
  assert.equal(buildLayout(0, 3, 2, "pentatonic").notes.length, 11);
  assert.equal(buildLayout(0, 3, 2, "blues").notes.length, 13);
});

test("edges map to the lowest and highest note; root offsets the range", () => {
  const l = buildLayout(0, 3, 2, "major"); // C3..C5
  assert.equal(l.low, 48);
  assert.equal(l.high, 72);
  assert.equal(xToMidi(l, 0), 48);
  assert.equal(xToMidi(l, 1), 72);
  assert.equal(xToMidi(l, -5), 48);
  assert.equal(xToMidi(l, 9), 72);
  assert.equal(buildLayout(9, 3, 1, "minor").low, 57); // A3
});

test("snapping lands only on scale notes", () => {
  const l = buildLayout(0, 4, 2, "pentatonic");
  const allowed = new Set(Array.from(l.notes));
  for (let i = 0; i <= 200; i++) assert.ok(allowed.has(xToMidi(l, i / 200)));
});

test("chromatic allows every semitone", () => {
  const l = buildLayout(0, 4, 1, "chromatic");
  const seen = new Set<number>();
  for (let i = 0; i <= 1000; i++) seen.add(xToMidi(l, i / 1000));
  assert.equal(seen.size, 13);
});

test("midi helpers", () => {
  assert.equal(midiToFreq(69), 440);
  assert.equal(midiToName(60), "C4");
  assert.equal(midiToName(61), "C#4");
  const l = buildLayout(0, 3, 2, "chromatic");
  assert.equal(midiToX(l, 60), 0.5);
});

test("brightness -> cutoff is logarithmic and monotonic", () => {
  const p = PRESETS.pure;
  assert.ok(Math.abs(cutoffHz(p, 0) - p.cutoffMin) < 1e-9);
  assert.ok(Math.abs(cutoffHz(p, 1) - p.cutoffMax) < 1e-6);
  const mid = cutoffHz(p, 0.5);
  assert.ok(Math.abs(mid - Math.sqrt(p.cutoffMin * p.cutoffMax)) < 1e-6); // geometric mean
  assert.ok(cutoffHz(p, 0.3) < cutoffHz(p, 0.7));
});
