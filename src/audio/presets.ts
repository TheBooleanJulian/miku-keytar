// Sound presets. All sounds are synthesised in real time from oscillators.

export type PresetId = "square" | "pure" | "digital" | "ethereal";

export interface Preset {
  label: string;
  /** Oscillator levels: [sine, triangle, sawtooth, square]. */
  mix: readonly [number, number, number, number];
  /** Detune (cents) applied +/- to the triangle and sawtooth for a slight chorus. */
  detune: number;
  /** Filter resonance. */
  q: number;
  /** Low-pass cutoff range (Hz) swept by the Y axis. */
  cutoffMin: number;
  cutoffMax: number;
  /** Seconds. */
  attack: number;
  release: number;
  /** Echo send level when effects are on. */
  wet: number;
  /** Chorus and reverb send levels when effects are on. */
  chorus: number;
  reverb: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  square: {
    label: "Square lead",
    mix: [0.3, 0, 0, 0.5], // square body with a sine underneath
    detune: 0,
    q: 1.5,
    cutoffMin: 300,
    cutoffMax: 9000,
    attack: 0.01,
    release: 0.16,
    wet: 0,
    chorus: 0.5,
    reverb: 0.25,
  },
  pure: {
    label: "Pure",
    mix: [0.65, 0.45, 0, 0],
    chorus: 0,
    reverb: 0,
    detune: 4,
    q: 0.8,
    cutoffMin: 220,
    cutoffMax: 7000,
    attack: 0.012,
    release: 0.18,
    wet: 0.22,
  },
  digital: {
    label: "Digital",
    mix: [0.15, 0.35, 0.55, 0],
    chorus: 0,
    reverb: 0,
    detune: 9,
    q: 5,
    cutoffMin: 300,
    cutoffMax: 11000,
    attack: 0.006,
    release: 0.09,
    wet: 0.18,
  },
  ethereal: {
    label: "Ethereal",
    mix: [0.7, 0.3, 0.12, 0],
    chorus: 0,
    reverb: 0,
    detune: 7,
    q: 1.2,
    cutoffMin: 160,
    cutoffMax: 4200,
    attack: 0.09,
    release: 0.7,
    wet: 0.5,
  },
};

/** Logarithmic mapping: brightness 0..1 -> cutoff in Hz. */
export function cutoffHz(preset: Preset, brightness: number): number {
  const y = brightness < 0 ? 0 : brightness > 1 ? 1 : brightness;
  return preset.cutoffMin * Math.pow(preset.cutoffMax / preset.cutoffMin, y);
}
