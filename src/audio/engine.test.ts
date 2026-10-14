// Voice-lifecycle tests against a fake AudioContext (no real audio in Node).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioEngine } from "./engine.ts";
import { makeFakeContext, type FakeNode } from "./fake-context.ts";

function setup() {
  const { ctx, oscs, asContext } = makeFakeContext();
  const engine = new AudioEngine(asContext);
  return { ctx, engine, oscs };
}

const voiceOscs = (oscs: FakeNode[]) => oscs.slice(2); // first two are the shared chorus and vibrato LFOs

test("init moves idle -> running and notifies listeners", async () => {
  const { engine } = setup();
  const seen: string[] = [];
  engine.onState((s) => seen.push(s));
  assert.equal(engine.state, "idle");
  await engine.init();
  assert.equal(engine.state, "running");
  assert.ok(seen.includes("running"));
});

test("noteOn is ignored until audio is running", async () => {
  const { engine, oscs } = setup();
  engine.noteOn(1, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 0);
  assert.equal(oscs.length, 0);
});

test("four simultaneous voices, each released independently with no orphans", async () => {
  const { engine, oscs } = setup();
  await engine.init();
  for (let id = 1; id <= 4; id++) engine.noteOn(id, 60 + id, 0.5);
  assert.equal(engine.activeVoiceCount, 4);
  assert.equal(voiceOscs(oscs).length, 16); // 4 oscillators per voice
  engine.noteOff(2);
  assert.equal(engine.activeVoiceCount, 3);
  for (const id of [1, 3, 4]) engine.noteOff(id);
  assert.equal(engine.activeVoiceCount, 0);
  assert.ok(voiceOscs(oscs).every((o) => o.startCalls === 1 && o.stopCalls >= 1));
});

test("a repeated down on the same id releases the previous voice", async () => {
  const { engine, oscs } = setup();
  await engine.init();
  engine.noteOn(7, 60, 0.5);
  engine.noteOn(7, 62, 0.5);
  assert.equal(engine.activeVoiceCount, 1);
  assert.ok(voiceOscs(oscs).slice(0, 4).every((o) => o.stopCalls >= 1));
});

test("stopAll silences everything, including releasing voices, and notifies", async () => {
  const { engine, oscs } = setup();
  await engine.init();
  let notified = 0;
  engine.onAllStopped(() => notified++);
  engine.noteOn(1, 60, 0.5);
  engine.noteOn(2, 64, 0.5);
  engine.noteOff(1); // still releasing
  engine.stopAll();
  assert.equal(engine.activeVoiceCount, 0);
  assert.equal(notified, 1);
  assert.ok(voiceOscs(oscs).every((o) => o.stopCalls >= 1));
});

test("voice count is capped by stealing the oldest", async () => {
  const { engine } = setup();
  await engine.init();
  for (let id = 1; id <= 20; id++) engine.noteOn(id, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 16);
});

test("moving or releasing an unknown voice is harmless", async () => {
  const { engine } = setup();
  await engine.init();
  engine.noteMove(99, 60, 0.5);
  engine.noteOff(99);
  assert.equal(engine.activeVoiceCount, 0);
});

test("rhythm target is only available once audio is built", async () => {
  const { engine } = setup();
  assert.equal(engine.rhythmTarget(), null);
  await engine.init();
  assert.ok(engine.rhythmTarget());
});
