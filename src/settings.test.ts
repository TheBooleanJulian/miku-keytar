import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_VOCAL } from "./audio/vocal/params.ts";
import { defaultSettings, parseSettings } from "./settings.ts";

test("by default the original keytar lead is selected and its settings are unchanged", () => {
  const d = defaultSettings();
  assert.equal(d.instrument, "lead");
  assert.equal(d.preset, "square");
  assert.equal(d.scale, "pentatonic");
  assert.equal(d.root, 0);
  assert.equal(d.lowOctave, 3);
  assert.equal(d.octaves, 2);
});

test("settings saved before the vocal engine existed load unchanged, still on the lead", () => {
  const d = defaultSettings();
  const legacy = { volume: 0.4, root: 7, scale: "minor", preset: "ethereal", lowOctave: 2, octaves: 3, glide: true };
  const s = parseSettings(legacy, d);
  assert.equal(s.volume, 0.4);
  assert.equal(s.root, 7);
  assert.equal(s.scale, "minor");
  assert.equal(s.preset, "ethereal");
  assert.equal(s.lowOctave, 2);
  assert.equal(s.octaves, 3);
  assert.equal(s.glide, true);
  assert.equal(s.instrument, "lead");
  assert.deepEqual(s.vocal, BUILTIN_VOCAL.miku.params); // vocal fields fall back to the new default preset
  assert.equal(s.vocalPreset, "miku");
  assert.equal(s.vocalAxis, "morph");
});

test("vocal settings round-trip and are sanitised", () => {
  const d = defaultSettings();
  const s = parseSettings(
    {
      instrument: "vocal",
      vocalAxis: "fixed",
      vocalPreset: "user:mine",
      vocalCompare: "default",
      auditionNote: 72,
      vocal: { brightness: 0.2, breath: 50, vowelTweaks: {} }, // current format (has vowelTweaks), partly invalid
    },
    d,
  );
  assert.equal(s.instrument, "vocal");
  assert.equal(s.vocalAxis, "fixed");
  assert.equal(s.vocalPreset, "user:mine");
  assert.equal(s.vocalCompare, "default");
  assert.equal(s.auditionNote, 72);
  assert.equal(s.vocal.brightness, 0.2);
  assert.equal(s.vocal.breath, 1);
});

test("vocal edits saved before per-vowel tweaks are replaced by their preset (they carried the old global F3 cut)", () => {
  const d = defaultSettings();
  const oldSaved = {
    vocalPreset: "miku",
    vocal: { ...BUILTIN_VOCAL.miku.params, vowelTweaks: undefined, tweaks: [{ freq: 1, bw: 1, gain: 1 }, { freq: 1, bw: 1.49, gain: 1 }, { freq: 1, bw: 1, gain: 0.15 }] },
  };
  const s = parseSettings(JSON.parse(JSON.stringify(oldSaved)), d);
  assert.equal(s.vocalPreset, "miku");
  assert.equal(s.vocal.tweaks[2].gain, 1, "the global F3 cut must be gone");
  assert.equal(s.vocal.vowelTweaks.a[2].gain, 0.15, "...and live on あ only");
  assert.equal(s.vocal.vowelTweaks.i[2].gain, 1);
  // an old edit on top of a different built-in preset returns to that preset
  const softSaved = { vocalPreset: "soft", vocal: { ...BUILTIN_VOCAL.soft.params, brightness: 0.9, vowelTweaks: undefined } };
  const soft = parseSettings(JSON.parse(JSON.stringify(softSaved)), d); // JSON drops the undefined key, as real storage does
  assert.equal(soft.vocalPreset, "soft");
  assert.equal(soft.vocal.brightness, BUILTIN_VOCAL.soft.params.brightness);
  // an old edit on a user preset falls back to the default preset
  const user = parseSettings({ vocalPreset: "user:mine", vocal: { brightness: 0.1 } }, d);
  assert.equal(user.vocalPreset, "miku");
  assert.deepEqual(user.vocal, BUILTIN_VOCAL.miku.params);
});

test("current-format vocal edits are kept", () => {
  const d = defaultSettings();
  const edited = { ...BUILTIN_VOCAL.miku.params, brightness: 0.2, vowelHold: 0.1 };
  const s = parseSettings(JSON.parse(JSON.stringify({ vocalPreset: "miku", vocal: edited })), d);
  assert.equal(s.vocal.brightness, 0.2);
  assert.equal(s.vocal.vowelHold, 0.1);
  assert.deepEqual(s.vocal.vowelTweaks, BUILTIN_VOCAL.miku.params.vowelTweaks);
});

test("invalid vocal fields fall back to defaults", () => {
  const d = defaultSettings();
  const s = parseSettings(
    { instrument: "banjo", vocalAxis: "diagonal", vocalPreset: "evil", vocalCompare: 3, auditionNote: 5000 },
    d,
  );
  assert.equal(s.instrument, "lead");
  assert.equal(s.vocalAxis, "morph");
  assert.equal(s.vocalPreset, "miku");
  assert.equal(s.vocalCompare, "edited");
  assert.equal(s.auditionNote, 60);
});

test("a saved vowel keeps its identity when the morph order changed to あ い う え お", () => {
  const d = defaultSettings();
  const saved = { vocalPreset: "miku", vocal: { ...BUILTIN_VOCAL.miku.params, vowelPos: 0.5 } }; // 0.5 was あ in the old order
  const s = parseSettings(JSON.parse(JSON.stringify(saved)), d);
  assert.equal(s.vocal.vowelPos, 0); // あ is now the bottom of the axis
  assert.equal(s.vowelOrder, "aiueo");
  const again = parseSettings(JSON.parse(JSON.stringify(s)), d); // already migrated: untouched
  assert.equal(again.vocal.vowelPos, 0);
});
