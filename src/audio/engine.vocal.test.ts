// Vocal instrument inside the engine: voice lifecycle, polyphony, switching and Stop All (fake AudioContext).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioEngine, type EngineSettings } from "./engine.ts";
import { makeFakeContext } from "./fake-context.ts";
import { PRESETS, cutoffHz } from "./presets.ts";
import { BUILTIN_VOCAL, cloneVocal, defaultVocal } from "./vocal/params.ts";

const LFOS = 2; // shared chorus + vibrato LFOs are the first two oscillators
const VOCAL_OSCS = 5; // pulse, saw, sine, vibrato, drift (plus one noise buffer source)
const LEAD_OSCS = 4;

function base(over: Partial<EngineSettings> = {}): EngineSettings {
  return {
    volume: 0.7,
    muted: false,
    preset: "square",
    effects: true,
    modulation: false,
    glide: false,
    rhythmVolume: 0.7,
    instrument: "vocal",
    vocal: defaultVocal(),
    vocalAxis: "morph",
    ...over,
  };
}

async function setup(over: Partial<EngineSettings> = {}) {
  const fake = makeFakeContext();
  const engine = new AudioEngine(fake.asContext);
  engine.configure(base(over));
  await engine.init();
  return { ...fake, engine };
}

test("a vocal note creates one voice with its sources, and noteOff releases and stops all of them", async () => {
  const { engine, oscs, bufferSources } = await setup();
  engine.noteOn(1, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 1);
  const voiceOscs = oscs.slice(LFOS);
  assert.equal(voiceOscs.length, VOCAL_OSCS);
  assert.equal(bufferSources.length, 1);
  assert.ok([...voiceOscs, ...bufferSources].every((n) => n.startCalls === 1 && n.stopCalls === 0));
  engine.noteOff(1);
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok([...voiceOscs, ...bufferSources].every((n) => n.stopCalls >= 1), "no source may be left running");
});

test("four simultaneous vocal notes are independent", async () => {
  const { engine, oscs, bufferSources } = await setup();
  for (let id = 1; id <= 4; id++) engine.noteOn(id, 55 + id * 3, 0.2 * id);
  assert.equal(engine.activeVoiceCount, 4);
  assert.equal(oscs.length - LFOS, 4 * VOCAL_OSCS);
  assert.equal(bufferSources.length, 4);
  engine.noteOff(2);
  assert.equal(engine.activeVoiceCount, 3);
  const stopped = oscs.slice(LFOS).filter((o) => o.stopCalls > 0).length;
  assert.equal(stopped, VOCAL_OSCS, "only the released voice's oscillators stop");
  for (const id of [1, 3, 4]) engine.noteOff(id);
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok(oscs.slice(LFOS).every((o) => o.stopCalls >= 1));
});

test("moving a vocal note (pitch and vowel) is safe, including unknown ids", async () => {
  const { engine } = await setup();
  engine.noteOn(1, 60, 0);
  for (let i = 0; i <= 20; i++) engine.noteMove(1, 60 + i, i / 20);
  engine.noteMove(99, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 1);
});

test("Stop All silences vocal voices, including ones already releasing, and notifies", async () => {
  const { engine, oscs, bufferSources } = await setup();
  let notified = 0;
  engine.onAllStopped(() => notified++);
  engine.noteOn(1, 60, 0.5);
  engine.noteOn(2, 64, 0.5);
  engine.noteOn(3, 67, 0.5);
  engine.noteOff(1); // still ringing out its release
  engine.stopAll();
  assert.equal(engine.activeVoiceCount, 0);
  assert.equal(notified, 1);
  assert.ok([...oscs.slice(LFOS), ...bufferSources].every((n) => n.stopCalls >= 1));
});

test("the voice cap applies to vocal voices too", async () => {
  const { engine } = await setup();
  for (let id = 1; id <= 24; id++) engine.noteOn(id, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 16);
});

test("repeated pointer-down on one id replaces the voice instead of stacking", async () => {
  const { engine, oscs } = await setup();
  engine.noteOn(7, 60, 0.5);
  engine.noteOn(7, 64, 0.5);
  assert.equal(engine.activeVoiceCount, 1);
  assert.ok(oscs.slice(LFOS, LFOS + VOCAL_OSCS).every((o) => o.stopCalls >= 1));
});

test("switching lead -> vocal while a note is held: the held note keeps its own instrument and ends cleanly", async () => {
  const { engine, oscs, bufferSources } = await setup({ instrument: "lead" });
  engine.noteOn(1, 60, 0.5); // a lead voice
  assert.equal(oscs.length - LFOS, LEAD_OSCS);
  engine.configure(base({ instrument: "vocal" }));
  engine.noteMove(1, 62, 0.8); // the held lead note keeps working
  engine.noteOn(2, 64, 0.5); // new notes are vocal
  assert.equal(engine.activeVoiceCount, 2);
  assert.equal(oscs.length - LFOS, LEAD_OSCS + VOCAL_OSCS);
  assert.equal(bufferSources.length, 1, "only the vocal voice uses a noise source");
  engine.noteOff(1);
  engine.noteOff(2);
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok(oscs.slice(LFOS).every((o) => o.stopCalls >= 1), "no orphaned oscillators");
});

test("switching vocal -> lead while a note is held is equally clean", async () => {
  const { engine, oscs } = await setup();
  engine.noteOn(1, 60, 0.5);
  engine.configure(base({ instrument: "lead" }));
  engine.noteOn(2, 64, 0.5);
  assert.equal(oscs.length - LFOS, VOCAL_OSCS + LEAD_OSCS);
  engine.stopAll();
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok(oscs.slice(LFOS).every((o) => o.stopCalls >= 1));
});

test("changing the vocal preset or parameters while notes are held applies without losing or duplicating voices", async () => {
  const { engine, oscs } = await setup();
  engine.noteOn(1, 60, 0.5);
  engine.noteOn(2, 67, 0.5);
  const before = oscs.length;
  for (const id of ["bright", "soft", "electronic"] as const) {
    engine.configure(base({ vocal: cloneVocal(BUILTIN_VOCAL[id].params) }));
    assert.equal(engine.activeVoiceCount, 2);
  }
  const wild = { ...defaultVocal(), pulseWidth: 0.1, brightness: 1, breath: 1, vibratoDepth: 80 };
  engine.configure(base({ vocal: wild, vocalAxis: "fixed" }));
  engine.noteMove(1, 62, 0.3);
  assert.equal(engine.activeVoiceCount, 2);
  assert.equal(oscs.length, before, "settings changes must not create extra oscillators");
});

test("changing the lead preset while a lead note is held still works (existing behaviour)", async () => {
  const { engine, oscs } = await setup({ instrument: "lead", preset: "pure" });
  engine.noteOn(1, 60, 0.5);
  engine.configure(base({ instrument: "lead", preset: "ethereal" }));
  engine.configure(base({ instrument: "lead", preset: "digital" }));
  assert.equal(engine.activeVoiceCount, 1);
  assert.equal(oscs.length - LFOS, LEAD_OSCS);
  engine.noteOff(1);
  assert.ok(oscs.slice(LFOS).every((o) => o.stopCalls >= 1));
});

test("existing lead mapping is preserved: brightness -> cutoff is unchanged and not affected by the vocal settings", async () => {
  const { engine } = await setup({ instrument: "lead", preset: "square" });
  for (const y of [0, 0.25, 0.5, 1]) {
    assert.equal(engine.cutoffFor(y), cutoffHz(PRESETS.square, y));
  }
  assert.match(engine.controlLabel(0.5), /^brightness 50% · \d+ Hz$/);
  // the same engine reports a vowel when the vocal instrument is active
  engine.configure(base({ instrument: "vocal", vocalAxis: "morph" }));
  assert.match(engine.controlLabel(0.5), /^vowel う/);
  assert.equal(engine.cutoffFor(0.5), cutoffHz(PRESETS.square, 0.5));
});

test("vocal notes are ignored until audio is running, like lead notes", async () => {
  const fake = makeFakeContext();
  const engine = new AudioEngine(fake.asContext);
  engine.configure(base());
  engine.noteOn(1, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 0);
  assert.equal(fake.oscs.length, 0);
});

test("spectrum access is available once audio is built and rejects too-small buffers", async () => {
  const fake = makeFakeContext();
  const engine = new AudioEngine(fake.asContext);
  assert.equal(engine.spectrumInfo(), null);
  assert.equal(engine.readSpectrum(new Float32Array(8)), false);
  await engine.init();
  const info = engine.spectrumInfo();
  assert.ok(info && info.bins > 0 && info.sampleRate > 0);
  assert.equal(engine.readSpectrum(new Float32Array(info.bins)), true);
  assert.equal(engine.readSpectrum(new Float32Array(1)), false);
});
