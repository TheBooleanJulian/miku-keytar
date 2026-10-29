// Vocal synthesis parameters: bounds, validation, built-in presets and the pure maths behind the excitation.

import {
  FORMANT_COUNT,
  clampTweak,
  identityTweaks,
  vowelPosition,
  type FormantTweak,
} from "./formants.ts";

/** How the vertical touch axis is used in vocal mode. */
export type VocalAxis = "morph" | "fixed";

export interface VocalParams {
  // excitation: what the "vocal folds" produce before the vocal tract shapes it
  pulse: number; // level of the band-limited pulse wave, 0..1
  pulseWidth: number; // duty cycle 0.05..0.5 (0.5 = square; narrower = brighter, more nasal)
  saw: number; // optional sawtooth level
  sine: number; // optional sine level (adds body)
  brightness: number; // 0..1: opens a low-pass on the excitation
  breath: number; // 0..1: filtered noise through the same vocal tract
  // vocal tract
  vowelPos: number; // 0..1 position on the vowel morph axis (used as-is in fixed mode)
  tracking: number; // 0..1: stylised pitch-dependent drift of the formants (0 = fully independent)
  tweaks: FormantTweak[]; // per-resonance multipliers on frequency, bandwidth and gain
  // expression
  vibratoRate: number; // Hz
  vibratoDepth: number; // cents
  vibratoDelay: number; // s before vibrato fades in
  jitter: number; // cents of slow, random-ish pitch drift
  attack: number; // s
  sustain: number; // 0..1 held level
  release: number; // s
  // effects (sends into the shared chorus and reverb)
  chorus: number;
  reverb: number;
}

type NumericKey = Exclude<keyof VocalParams, "tweaks">;

export const VOCAL_LIMITS: Record<NumericKey, readonly [number, number]> = {
  pulse: [0, 1],
  pulseWidth: [0.05, 0.5],
  saw: [0, 1],
  sine: [0, 1],
  brightness: [0, 1],
  breath: [0, 1],
  vowelPos: [0, 1],
  tracking: [0, 1],
  vibratoRate: [2, 9],
  vibratoDepth: [0, 80],
  vibratoDelay: [0, 1.5],
  jitter: [0, 30],
  attack: [0.002, 0.5],
  sustain: [0.2, 1],
  release: [0.02, 1.5],
  chorus: [0, 1],
  reverb: [0, 1],
};

const NUMERIC_KEYS = Object.keys(VOCAL_LIMITS) as NumericKey[];

function withTweaks(over: Array<Partial<FormantTweak> | undefined>): FormantTweak[] {
  const t = identityTweaks();
  over.forEach((o, i) => {
    if (o) t[i] = { ...t[i], ...o };
  });
  return t;
}

export type BuiltinVocalId = "miku" | "bright" | "soft" | "electronic";

export const BUILTIN_VOCAL: Record<BuiltinVocalId, { label: string; blurb: string; params: VocalParams }> = {
  miku: {
    label: "Miku-inspired (ref fit)",
    blurb:
      "Fitted to a reference recording of a held あ: dark around 3 kHz, a broader second formant, a little breath, " +
      "and a slow, deep 3.3 Hz vibrato. A starting point to tune by ear, not a clone of any voicebank.",
    params: {
      pulse: 0.8,
      pulseWidth: 0.28,
      saw: 0.25,
      sine: 0,
      brightness: 0.7,
      breath: 0.18,
      vowelPos: vowelPosition("a"),
      tracking: 0.25,
      tweaks: withTweaks([
        { freq: 1.015 },
        { freq: 1.03, bw: 1.49 },
        { freq: 1.0175, gain: 0.15 }, // the reference has a clear dip around 3 kHz
        { gain: 0.6 },
        { gain: 0.5 },
      ]),
      vibratoRate: 3.3, // measured on every steady note of the reference
      vibratoDepth: 40, // cents, peak
      vibratoDelay: 0.45, // the reference's onsets are not measurable, so this is a playing choice
      jitter: 0,
      attack: 0.012,
      sustain: 1,
      release: 0.14,
      chorus: 0.12,
      reverb: 0.1,
    },
  },
  bright: {
    label: "Bright Vocal",
    blurb: "Clear, forward and relatively clean.",
    params: {
      pulse: 0.8,
      pulseWidth: 0.28,
      saw: 0.25,
      sine: 0.1,
      brightness: 0.7,
      breath: 0.06,
      vowelPos: vowelPosition("a"),
      tracking: 0.3,
      tweaks: withTweaks([undefined, { freq: 1.03 }, { gain: 1.35 }, { gain: 1.3 }, undefined]),
      vibratoRate: 5.4,
      vibratoDepth: 14,
      vibratoDelay: 0.35,
      jitter: 3,
      attack: 0.012,
      sustain: 1,
      release: 0.14,
      chorus: 0.12,
      reverb: 0.1,
    },
  },
  soft: {
    label: "Soft Vocal",
    blurb: "Smoother excitation, gentler resonances, restrained brightness.",
    params: {
      pulse: 0.55,
      pulseWidth: 0.5,
      saw: 0,
      sine: 0.45,
      brightness: 0.4,
      breath: 0.14,
      vowelPos: vowelPosition("a"),
      tracking: 0.25,
      tweaks: withTweaks([
        { bw: 1.25 },
        { bw: 1.25 },
        { bw: 1.25, gain: 0.7 },
        { bw: 1.25, gain: 0.55 },
        { bw: 1.25, gain: 0.4 },
      ]),
      vibratoRate: 5,
      vibratoDepth: 10,
      vibratoDelay: 0.5,
      jitter: 4,
      attack: 0.05,
      sustain: 0.9,
      release: 0.3,
      chorus: 0.15,
      reverb: 0.2,
    },
  },
  electronic: {
    label: "Electronic Vocal",
    blurb: "Stronger harmonics, a more pronounced synthetic edge, light modulation.",
    params: {
      pulse: 0.7,
      pulseWidth: 0.16,
      saw: 0.5,
      sine: 0,
      brightness: 0.88,
      breath: 0.03,
      vowelPos: vowelPosition("a"),
      tracking: 0.45,
      tweaks: withTweaks([
        { gain: 1.1 },
        { freq: 1.06, gain: 1.2, bw: 0.85 },
        { gain: 1.5, bw: 0.85 },
        { gain: 1.4 },
        undefined,
      ]),
      vibratoRate: 6.2,
      vibratoDepth: 22,
      vibratoDelay: 0.2,
      jitter: 0,
      attack: 0.006,
      sustain: 1,
      release: 0.1,
      chorus: 0.35,
      reverb: 0.1,
    },
  },
};

export const BUILTIN_VOCAL_IDS = Object.keys(BUILTIN_VOCAL) as BuiltinVocalId[];

export function cloneVocal(p: VocalParams): VocalParams {
  return { ...p, tweaks: p.tweaks.map((t) => ({ ...t })) };
}

export function defaultVocal(): VocalParams {
  return cloneVocal(BUILTIN_VOCAL.bright.params);
}

/** Clamps every field into its bounds; anything missing or not a finite number falls back to `base`. Never throws. */
export function sanitizeVocal(raw: unknown, base: VocalParams = defaultVocal()): VocalParams {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = cloneVocal(base);
  for (const key of NUMERIC_KEYS) {
    const v = src[key];
    const [lo, hi] = VOCAL_LIMITS[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.min(hi, Math.max(lo, v));
  }
  const tw = Array.isArray(src.tweaks) ? src.tweaks : [];
  out.tweaks = Array.from({ length: FORMANT_COUNT }, (_, i) =>
    clampTweak((tw[i] as Partial<FormantTweak> | undefined) ?? base.tweaks[i]),
  );
  return out;
}

// ---- excitation maths ----------------------------------------------------

/**
 * Fourier coefficients of a pulse train with duty cycle `width`, for AudioContext.createPeriodicWave.
 * Harmonic n has amplitude (2 / nπ)·sin(nπ·width) with the phase of a pulse starting at t = 0, so the waveform is
 * a true pulse (not just a pulse-shaped spectrum). Index 0 (DC) is zero.
 */
export function pulseWaveCoeffs(width: number, harmonics = 96): { real: Float32Array; imag: Float32Array } {
  const d = Math.min(0.5, Math.max(0.05, width));
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    const a = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
    real[n] = a * Math.cos(n * Math.PI * d);
    imag[n] = a * Math.sin(n * Math.PI * d);
  }
  return { real, imag };
}

/** Brightness 0..1 -> low-pass cutoff (Hz) on the excitation, logarithmic. */
export function brightnessToCutoff(brightness: number): number {
  const b = brightness < 0 ? 0 : brightness > 1 ? 1 : brightness;
  return 1500 * Math.pow(12000 / 1500, b);
}

/**
 * In morph mode the vertical axis picks the vowel, so brightness is exactly the panel value. In fixed-vowel mode
 * the vertical axis nudges brightness around the panel value (±0.4), like the lead's brightness axis.
 */
export function effectiveBrightness(base: number, y: number, axis: VocalAxis): number {
  if (axis === "morph") return base;
  const b = base + (y - 0.5) * 0.8;
  return b < 0 ? 0 : b > 1 ? 1 : b;
}

/** Vowel position to use: the finger in morph mode, the panel value in fixed mode. */
export function effectiveVowelPos(base: number, y: number, axis: VocalAxis): number {
  return axis === "morph" ? Math.min(1, Math.max(0, y)) : base;
}
