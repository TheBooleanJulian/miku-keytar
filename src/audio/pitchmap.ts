// Pure pitch-mapping helpers: screen X (0..1) -> musical note. No DOM / audio imports.

export type ScaleId = "chromatic" | "major" | "minor" | "pentatonic" | "blues";

export const SCALES: Record<ScaleId, { label: string; steps: readonly number[] }> = {
  chromatic: { label: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { label: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "Natural minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { label: "Pentatonic", steps: [0, 2, 4, 7, 9] },
  blues: { label: "Blues", steps: [0, 3, 5, 6, 7, 10] },
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export interface PitchLayout {
  /** MIDI number at the left edge (always the root note). */
  low: number;
  /** MIDI number at the right edge (root, `octaves` above `low`). */
  high: number;
  /** Playable MIDI notes, ascending, including both edges. */
  notes: Float64Array;
}

/** `lowOctave` uses scientific pitch notation (C4 = middle C = MIDI 60). */
export function buildLayout(root: number, lowOctave: number, octaves: number, scale: ScaleId): PitchLayout {
  const low = 12 * (lowOctave + 1) + root;
  const high = low + 12 * octaves;
  const steps = SCALES[scale].steps;
  const list: number[] = [];
  for (let m = low; m <= high; m++) {
    if (steps.includes((m - low) % 12)) list.push(m);
  }
  return { low, high, notes: Float64Array.from(list) };
}

/** Snap a horizontal position (0..1) to the nearest playable note. */
export function xToMidi(layout: PitchLayout, x: number): number {
  const clamped = x < 0 ? 0 : x > 1 ? 1 : x;
  const raw = layout.low + clamped * (layout.high - layout.low);
  const notes = layout.notes;
  let best = notes[0];
  let bestDist = Math.abs(raw - best);
  for (let i = 1; i < notes.length; i++) {
    const d = Math.abs(raw - notes[i]);
    if (d < bestDist) {
      best = notes[i];
      bestDist = d;
    }
  }
  return best;
}

export function midiToX(layout: PitchLayout, midi: number): number {
  return (midi - layout.low) / (layout.high - layout.low);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
