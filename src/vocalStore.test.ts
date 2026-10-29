import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_VOCAL, defaultVocal } from "./audio/vocal/params.ts";
import {
  MAX_NAME_LENGTH,
  MAX_USER_PRESETS,
  cleanName,
  deleteUserPreset,
  loadUserPresets,
  resolvePreset,
  saveUserPreset,
  type StorageLike,
} from "./vocalStore.ts";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test("saved presets persist and reload identically", () => {
  const storage = memoryStorage();
  const edited = { ...defaultVocal(), brightness: 0.31, vibratoDepth: 40 };
  const saved = saveUserPreset({}, "My Voice", edited, storage);
  assert.ok(saved);
  const reloaded = loadUserPresets(storage);
  assert.deepEqual(Object.keys(reloaded), ["My Voice"]);
  assert.deepEqual(reloaded["My Voice"], edited);
});

test("saving never touches the built-in presets", () => {
  const before = JSON.stringify(BUILTIN_VOCAL);
  saveUserPreset({}, "bright", { ...defaultVocal(), brightness: 0 }, memoryStorage());
  assert.equal(JSON.stringify(BUILTIN_VOCAL), before);
  // a user preset called "bright" is addressed as "user:bright", so it cannot shadow the built-in either
  assert.equal(resolvePreset("bright", {}).brightness, BUILTIN_VOCAL.bright.params.brightness);
});

test("names are cleaned, empty names are refused", () => {
  assert.equal(cleanName("  my   voice \n"), "my voice");
  assert.equal(cleanName("x".repeat(100)).length, MAX_NAME_LENGTH);
  assert.equal(saveUserPreset({}, "   ", defaultVocal(), memoryStorage()), null);
});

test("the list is capped but existing names can still be overwritten", () => {
  const storage = memoryStorage();
  let list = {};
  for (let i = 0; i < MAX_USER_PRESETS; i++) {
    const next = saveUserPreset(list, `p${i}`, defaultVocal(), storage);
    assert.ok(next);
    list = next;
  }
  assert.equal(saveUserPreset(list, "one too many", defaultVocal(), storage), null);
  assert.ok(saveUserPreset(list, "p3", { ...defaultVocal(), breath: 0.5 }, storage));
});

test("delete removes a preset from memory and storage", () => {
  const storage = memoryStorage();
  const list = saveUserPreset({}, "a", defaultVocal(), storage)!;
  const after = deleteUserPreset(list, "a", storage);
  assert.deepEqual(after, {});
  assert.deepEqual(loadUserPresets(storage), {});
});

test("corrupt or hostile stored data is sanitised, never thrown", () => {
  assert.deepEqual(loadUserPresets(memoryStorage({ "miku-keytar:vocal-presets:v1": "not json" })), {});
  assert.deepEqual(loadUserPresets(memoryStorage({ "miku-keytar:vocal-presets:v1": "42" })), {});
  const evil = JSON.stringify({ ok: { brightness: 99, vibratoRate: "x", tweaks: [{ freq: 1e9 }] } });
  const loaded = loadUserPresets(memoryStorage({ "miku-keytar:vocal-presets:v1": evil }));
  assert.equal(loaded.ok.brightness, 1);
  assert.equal(loaded.ok.vibratoRate, defaultVocal().vibratoRate);
  assert.equal(loaded.ok.tweaks[0].freq, 1.6);
});

test("missing or blocked storage degrades gracefully", () => {
  assert.deepEqual(loadUserPresets(null), {});
  const blocked: StorageLike = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.deepEqual(loadUserPresets(blocked), {});
  assert.ok(saveUserPreset({}, "x", defaultVocal(), blocked)); // still works in memory for the session
});

test("preset ids resolve; unknown ids fall back to Bright Vocal", () => {
  const users = { mine: { ...defaultVocal(), breath: 0.9 } };
  assert.equal(resolvePreset("soft", users).pulseWidth, BUILTIN_VOCAL.soft.params.pulseWidth);
  assert.equal(resolvePreset("user:mine", users).breath, 0.9);
  assert.deepEqual(resolvePreset("user:gone", users), defaultVocal());
  assert.deepEqual(resolvePreset("???", users), defaultVocal());
  // resolving returns a copy: editing it can't change the built-in
  resolvePreset("bright", users).tweaks[0].freq = 9;
  assert.equal(BUILTIN_VOCAL.bright.params.tweaks[0].freq, 1);
});
