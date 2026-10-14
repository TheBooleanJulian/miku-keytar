import assert from "node:assert/strict";
import { test } from "node:test";
import { diatonicChords } from "./chords.ts";
import { makeFakeContext } from "./fake-context.ts";
import { PATTERNS } from "./patterns.ts";
import { RhythmEngine, type RhythmConfig } from "./rhythm.ts";

test("there are ten patterns, each fully specified", () => {
  assert.equal(PATTERNS.length, 10);
  assert.equal(new Set(PATTERNS.map((p) => p.name)).size, 10);
  for (const p of PATTERNS) {
    for (const key of ["kick", "snare", "hat", "open", "bass", "arp", "pad"] as const) {
      assert.equal(p[key].length, 16, `${p.name}.${key} must be 16 steps`);
    }
    assert.match(p.kick + p.snare + p.hat + p.open, /^[xo.]+$/, `${p.name} drum chars`);
    assert.match(p.bass, /^[158.]+$/, `${p.name} bass chars`);
    assert.match(p.arp, /^[0-3.]+$/, `${p.name} arp chars`);
    assert.match(p.pad, /^(S\.{15}|[x.]{16})$/, `${p.name} pad chars`);
    assert.ok(p.bpm >= 50 && p.bpm <= 200);
    assert.ok(p.kick.includes("x"), `${p.name} should have a kick`);
  }
});

function setup(patternIndex: number, layers = { drums: true, bass: true, pad: true, arp: true }) {
  const fake = makeFakeContext();
  fake.ctx.state = "running";
  let chord: ReturnType<typeof diatonicChords>[number] | null = diatonicChords(0, "major", false)[0];
  const rhythm = new RhythmEngine(
    () => ({ ctx: fake.asContext(), out: { connect: () => {} } as unknown as AudioNode }),
    () => chord,
  );
  const cfg: RhythmConfig = { pattern: patternIndex, bpm: PATTERNS[patternIndex].bpm, layers };
  rhythm.configure(cfg);
  return { fake, rhythm, setChord: (c: typeof chord) => (chord = c) };
}

test("every pattern schedules a full bar of sound without throwing", () => {
  for (let i = 0; i < PATTERNS.length; i++) {
    const { fake, rhythm } = setup(i);
    assert.ok(rhythm.start());
    // advance the audio clock two bars, ticking as the timer would
    for (let t = 0; t < 4; t += 0.02) {
      fake.ctx.currentTime = t;
      rhythm.tick();
    }
    assert.ok(fake.oscs.length > 0, `${PATTERNS[i].name} should create oscillators`);
    rhythm.stop();
    assert.equal(rhythm.running, false);
  }
});

test("stopping silences the rhythm and releases the pad", () => {
  const { fake, rhythm } = setup(0);
  rhythm.start();
  fake.ctx.currentTime = 0.5;
  rhythm.tick();
  const before = fake.oscs.length;
  rhythm.stop();
  fake.ctx.currentTime = 5;
  rhythm.tick(); // timer is cleared, so nothing more is scheduled
  assert.equal(fake.oscs.length, before);
  assert.ok(fake.oscs.every((o) => o.startCalls === 1));
});

test("without a chord only drums play; muted layers add nothing", () => {
  const drumsOnly = setup(0);
  drumsOnly.setChord(null);
  drumsOnly.rhythm.start();
  for (let t = 0; t < 2; t += 0.02) {
    drumsOnly.fake.ctx.currentTime = t;
    drumsOnly.rhythm.tick();
  }
  // kick and snare bodies are oscillators; bass/pad/arp would add many more
  const drumOscs = drumsOnly.fake.oscs.length;
  drumsOnly.rhythm.stop();

  const noDrums = setup(0, { drums: false, bass: false, pad: false, arp: false });
  noDrums.rhythm.start();
  for (let t = 0; t < 2; t += 0.02) {
    noDrums.fake.ctx.currentTime = t;
    noDrums.rhythm.tick();
  }
  noDrums.rhythm.stop();
  assert.equal(noDrums.fake.oscs.length, 0);
  assert.ok(drumOscs > 0);

  const full = setup(0);
  full.rhythm.start();
  for (let t = 0; t < 2; t += 0.02) {
    full.fake.ctx.currentTime = t;
    full.rhythm.tick();
  }
  full.rhythm.stop();
  assert.ok(full.fake.oscs.length > drumOscs);
});

test("start fails gracefully before audio exists", () => {
  const rhythm = new RhythmEngine(
    () => null,
    () => null,
  );
  assert.equal(rhythm.start(), false);
  assert.equal(rhythm.running, false);
});
