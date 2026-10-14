// Voice-lifecycle tests against a fake AudioContext (no real audio in Node).
import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioEngine } from "./engine.ts";

class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

interface FakeNode {
  stopCalls: number;
  startCalls: number;
  [key: string]: unknown;
}

function fakeNode(): FakeNode {
  const target: Record<string, unknown> = {
    stopCalls: 0,
    startCalls: 0,
    connect: (n: unknown) => n,
    disconnect: () => {},
    start() {
      (this as FakeNode).startCalls++;
    },
    stop() {
      (this as FakeNode).stopCalls++;
    },
  };
  // Any other property read is treated as an AudioParam.
  return new Proxy(target, {
    get(t, p) {
      if (typeof p === "string" && !(p in t)) t[p] = new FakeParam();
      return t[p as string];
    },
  }) as FakeNode;
}

function setup() {
  const oscs: FakeNode[] = [];
  const ctx = {
    state: "suspended",
    currentTime: 0,
    destination: fakeNode(),
    onstatechange: null as null | (() => void),
    createGain: fakeNode,
    createBiquadFilter: fakeNode,
    createDelay: fakeNode,
    createDynamicsCompressor: fakeNode,
    createAnalyser: () => Object.assign(fakeNode(), { fftSize: 256 }),
    createOscillator: () => {
      const o = fakeNode();
      oscs.push(o);
      return o;
    },
    async resume() {
      ctx.state = "running";
      ctx.onstatechange?.();
    },
    async close() {},
  };
  const engine = new AudioEngine(() => ctx as unknown as AudioContext);
  return { ctx, engine, oscs };
}

const voiceOscs = (oscs: FakeNode[]) => oscs.slice(1); // index 0 is the shared LFO

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
  assert.equal(voiceOscs(oscs).length, 12); // 3 oscillators per voice
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
  assert.ok(voiceOscs(oscs).slice(0, 3).every((o) => o.stopCalls >= 1));
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
  for (let id = 1; id <= 14; id++) engine.noteOn(id, 60, 0.5);
  assert.equal(engine.activeVoiceCount, 10);
});

test("moving or releasing an unknown voice is harmless", async () => {
  const { engine } = setup();
  await engine.init();
  engine.noteMove(99, 60, 0.5);
  engine.noteOff(99);
  assert.equal(engine.activeVoiceCount, 0);
});
