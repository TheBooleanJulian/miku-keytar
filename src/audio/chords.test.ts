import assert from "node:assert/strict";
import { test } from "node:test";
import { chordVoicing, diatonicChords, nearestChordTone, pitchAtOrAbove } from "./chords.ts";

const names = (root: number, mode: "major" | "minor", sevenths = false) =>
  diatonicChords(root, mode, sevenths).map((c) => c.name);

test("C major triads", () => {
  assert.deepEqual(names(0, "major"), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
});

test("A natural minor triads", () => {
  assert.deepEqual(names(9, "minor"), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
});

test("C major seventh chords", () => {
  assert.deepEqual(names(0, "major", true), ["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
});

test("roman numerals follow chord quality", () => {
  assert.deepEqual(
    diatonicChords(0, "major", false).map((c) => c.roman),
    ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
  );
  assert.deepEqual(
    diatonicChords(0, "minor", false).map((c) => c.roman),
    ["i", "ii°", "III", "iv", "v", "VI", "VII"],
  );
});

test("pitch classes are rooted and stacked in thirds, in any key", () => {
  const g = diatonicChords(7, "major", false); // G major: I = G B D, V = D F# A
  assert.deepEqual(g[0].pcs, [7, 11, 2]);
  assert.deepEqual(g[4].pcs, [2, 6, 9]);
});

test("voicing is ascending from the root", () => {
  const v = chordVoicing(diatonicChords(0, "major", false)[4], 52); // G major near E3
  assert.deepEqual(v, [55, 59, 62]);
  for (const chord of diatonicChords(5, "minor", true)) {
    const notes = chordVoicing(chord);
    assert.ok(notes.every((n, i) => i === 0 || n > notes[i - 1]));
  }
  assert.equal(pitchAtOrAbove(0, 28), 36);
  assert.equal(pitchAtOrAbove(4, 28), 28);
});

test("nearest chord tone searches both directions, ties go down", () => {
  const cMajor = [0, 4, 7];
  assert.equal(nearestChordTone(60, cMajor), 60); // already a chord tone
  assert.equal(nearestChordTone(62, cMajor), 60); // D4 is 2 from C4, 2 from E4 -> lower
  assert.equal(nearestChordTone(65, cMajor), 64); // F4 -> E4
  assert.equal(nearestChordTone(66, cMajor), 67); // F#4 -> G4
  assert.equal(nearestChordTone(71, cMajor), 72); // B4 -> C5 (crosses octave)
});
