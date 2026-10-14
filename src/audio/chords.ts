// Diatonic chord theory. Pure functions, no DOM / audio imports.

import { NOTE_NAMES } from "./pitchmap.ts";

export type KeyMode = "major" | "minor";

const STEPS: Record<KeyMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

export interface Chord {
  /** 0..6 scale degree. */
  degree: number;
  /** Roman numeral; lower case for minor/diminished, "°" for diminished. */
  roman: string;
  /** e.g. "Am", "G7", "Bdim". */
  name: string;
  rootPc: number;
  /** Pitch classes (0..11), root first, then stacked thirds. */
  pcs: readonly number[];
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** The seven chords built by stacking thirds on each degree of the key. */
export function diatonicChords(keyRoot: number, mode: KeyMode, sevenths: boolean): Chord[] {
  const steps = STEPS[mode];
  const size = sevenths ? 4 : 3;
  return steps.map((_, d) => {
    const rel: number[] = [];
    for (let k = 0; k < size; k++) {
      const idx = d + 2 * k;
      rel.push(steps[idx % 7] + (idx >= 7 ? 12 : 0)); // semitones above the key root, ascending
    }
    const intervals = rel.map((r) => r - rel[0]);
    const third = intervals[1];
    const fifth = intervals[2];
    const seventh = intervals[3];
    const dim = third === 3 && fifth === 6;
    const minor = third === 3 && !dim;

    let suffix: string;
    if (!sevenths) suffix = dim ? "dim" : minor ? "m" : "";
    else if (dim) suffix = seventh === 10 ? "m7b5" : "dim7";
    else if (minor) suffix = seventh === 10 ? "m7" : "m(maj7)";
    else suffix = seventh === 11 ? "maj7" : "7";

    const rootPc = mod12(keyRoot + rel[0]);
    const numeral = dim || minor ? ROMAN[d].toLowerCase() : ROMAN[d];
    return {
      degree: d,
      roman: numeral + (dim ? "°" : ""),
      name: NOTE_NAMES[rootPc] + suffix,
      rootPc,
      pcs: rel.map((r) => mod12(keyRoot + r)),
    };
  });
}

/** Lowest MIDI note >= `base` with pitch class `pc`. */
export function pitchAtOrAbove(pc: number, base: number): number {
  return base + mod12(pc - base);
}

/** Close-position voicing, ascending, root at or above `base`. */
export function chordVoicing(chord: Chord, base = 52): number[] {
  const root = pitchAtOrAbove(chord.pcs[0], base);
  const notes = [root];
  for (let k = 1; k < chord.pcs.length; k++) {
    let m = root + mod12(chord.pcs[k] - chord.pcs[0]);
    while (m <= notes[k - 1]) m += 12;
    notes.push(m);
  }
  return notes;
}

/** Nearest MIDI note (any octave) whose pitch class is in `pcs`; ties go to the lower note. */
export function nearestChordTone(midi: number, pcs: readonly number[]): number {
  for (let d = 0; d <= 6; d++) {
    if (pcs.includes(mod12(midi - d))) return midi - d;
    if (pcs.includes(mod12(midi + d))) return midi + d;
  }
  return midi;
}
