import assert from "node:assert/strict";
import { test } from "node:test";
import { TapTempo } from "./taptempo.ts";

test("needs two taps before reporting a tempo", () => {
  const t = new TapTempo();
  assert.equal(t.tap(0), null);
  assert.equal(t.tap(500), 120); // 500 ms apart = 120 BPM
});

test("averages several taps", () => {
  const t = new TapTempo();
  let bpm: number | null = null;
  for (const time of [0, 600, 1200, 1800, 2400]) bpm = t.tap(time);
  assert.equal(bpm, 100);
});

test("steady taps smooth out one sloppy tap over time", () => {
  const t = new TapTempo();
  let bpm: number | null = null;
  for (const time of [0, 500, 1000, 1550, 2000, 2500, 3000, 3500, 4000, 4500]) bpm = t.tap(time);
  assert.equal(bpm, 120); // the sloppy 1550 has scrolled out of the last-6 window
});

test("a long pause starts over", () => {
  const t = new TapTempo();
  t.tap(0);
  t.tap(400);
  assert.equal(t.tap(10_000), null); // new count: one tap
  assert.equal(t.count, 1);
  assert.equal(t.tap(10_600), 100);
});

test("tempo is clamped to the supported range", () => {
  const fast = new TapTempo();
  fast.tap(0);
  assert.equal(fast.tap(100), 200); // 600 BPM -> clamped
  const slow = new TapTempo();
  slow.tap(0);
  assert.equal(slow.tap(1900), 50); // ~31 BPM -> clamped
});

test("reset clears the count", () => {
  const t = new TapTempo();
  t.tap(0);
  t.reset();
  assert.equal(t.count, 0);
});
