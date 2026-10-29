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
      vocal: { brightness: 0.2, breath: 50 },
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
