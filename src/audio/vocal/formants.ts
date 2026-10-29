// Vowel formant tables and the maths around them. Pure functions: no DOM, no Web Audio.
//
// The numbers below are plausible starting estimates for sung Japanese vowels by a higher voice, intended as
// tuning parameters. They are NOT measurements of any particular singer or voicebank.

export interface Formant {
  /** Centre frequency in Hz. */
  freq: number;
  /** -3 dB bandwidth in Hz. */
  bw: number;
  /** Linear gain relative to the other resonances. */
  gain: number;
}

export interface FormantTweak {
  /** Multiplier on every vowel's frequency for this resonance. */
  freq: number;
  /** Multiplier on bandwidth. */
  bw: number;
  /** Multiplier on gain. */
  gain: number;
}

export const FORMANT_COUNT = 5;

export type VowelId = "a" | "i" | "u" | "e" | "o";

export interface VowelInfo {
  kana: string;
  ipa: string;
  formants: readonly Formant[];
}

// Sung bandwidths are wider than spoken ones: wide enough that a harmonic landing on a formant does not make a
// note jump in loudness (measured: narrow 90 Hz F1 bands swung level by 5x between neighbouring pitches).
const BW = [150, 170, 210, 260, 320];
const GAIN = [1, 0.7, 0.45, 0.28, 0.16];

function vowel(kana: string, ipa: string, freqs: number[], bwOverride?: Record<number, number>): VowelInfo {
  return {
    kana,
    ipa,
    formants: freqs.map((freq, i) => ({ freq, bw: bwOverride?.[i] ?? BW[i], gain: GAIN[i] })),
  };
}

export const VOWELS: Record<VowelId, VowelInfo> = {
  a: vowel("あ", "/a/", [850, 1350, 2800, 3500, 4500]),
  i: vowel("い", "/i/", [330, 2750, 3300, 3800, 4700], { 0: 110 }),
  u: vowel("う", "/ɯ/", [380, 1450, 2500, 3500, 4500]), // unrounded Japanese /ɯ/
  e: vowel("え", "/e/", [550, 2400, 3000, 3700, 4600]),
  o: vowel("お", "/o/", [560, 950, 2550, 3500, 4500]),
};

/** Selector order (the gojūon order: あ い う え お). */
export const VOWEL_ORDER: readonly VowelId[] = ["a", "i", "u", "e", "o"];

/**
 * Order used for the continuous morph: neighbours are acoustically close (second formant rises from う to い),
 * so every step is a gentle slide and the top of the range is the brightest vowel.
 */
export const MORPH_ORDER: readonly VowelId[] = ["u", "o", "a", "e", "i"];
const MORPH_SPANS = MORPH_ORDER.length - 1;

export const FORMANT_LIMITS = {
  freq: [80, 9000],
  bw: [30, 2500],
  gain: [0, 3],
} as const;

export const TWEAK_LIMITS = {
  freq: [0.6, 1.6],
  bw: [0.4, 3],
  gain: [0, 2],
} as const;

export const IDENTITY_TWEAK: FormantTweak = { freq: 1, bw: 1, gain: 1 };

const clamp = (v: number, [lo, hi]: readonly [number, number] | readonly number[]): number =>
  v < lo ? lo : v > hi ? hi : v;

export function makeFormants(): Formant[] {
  return Array.from({ length: FORMANT_COUNT }, () => ({ freq: 0, bw: 0, gain: 0 }));
}

export function identityTweaks(): FormantTweak[] {
  return Array.from({ length: FORMANT_COUNT }, () => ({ ...IDENTITY_TWEAK }));
}

/** Position (0..1) of a vowel on the morph axis. */
export function vowelPosition(id: VowelId): number {
  return MORPH_ORDER.indexOf(id) / MORPH_SPANS;
}

export function nearestVowel(pos: number): VowelId {
  const i = Math.round(Math.min(1, Math.max(0, pos)) * MORPH_SPANS);
  return MORPH_ORDER[i];
}

/** Short label for a morph position: the kana when close to a vowel, else "あ→え". */
export function vowelLabel(pos: number): string {
  const x = Math.min(1, Math.max(0, pos)) * MORPH_SPANS;
  const near = Math.round(x);
  if (Math.abs(x - near) < 0.18) return VOWELS[MORPH_ORDER[near]].kana;
  const lo = Math.floor(x);
  return `${VOWELS[MORPH_ORDER[lo]].kana}→${VOWELS[MORPH_ORDER[Math.min(lo + 1, MORPH_SPANS)]].kana}`;
}

/**
 * Interpolates between neighbouring vowels along the morph axis, writing into `out` (no allocation, so it is safe
 * to call on every pointer move). Frequency and bandwidth interpolate geometrically, which sounds even across the
 * range; gain interpolates linearly.
 */
export function morphInto(out: Formant[], pos: number): void {
  const p = pos < 0 ? 0 : pos > 1 ? 1 : pos;
  const x = p * MORPH_SPANS;
  const lo = Math.min(Math.floor(x), MORPH_SPANS - 1);
  const t = x - lo;
  const a = VOWELS[MORPH_ORDER[lo]].formants;
  const b = VOWELS[MORPH_ORDER[lo + 1]].formants;
  for (let i = 0; i < FORMANT_COUNT; i++) {
    out[i].freq = a[i].freq * Math.pow(b[i].freq / a[i].freq, t);
    out[i].bw = a[i].bw * Math.pow(b[i].bw / a[i].bw, t);
    out[i].gain = a[i].gain + (b[i].gain - a[i].gain) * t;
  }
}

/**
 * Optional stylised pitch dependence of the vocal tract: 0 keeps the formants fixed whatever the pitch; higher
 * values drift them gently upward on high notes (and down on low ones). Deliberately weak: formants are a
 * property of the vocal tract, not of the pitch.
 */
export function formantScale(f0: number, tracking: number): number {
  const s = Math.pow(Math.max(f0, 1) / 261.63, 0.5 * tracking);
  return s < 0.8 ? 0.8 : s > 1.4 ? 1.4 : s;
}

/** Applies the user's per-resonance tweaks and the pitch-dependent scale, then clamps everything to safe bounds. */
export function tweakInto(out: Formant[], tweaks: readonly FormantTweak[], scale: number): void {
  for (let i = 0; i < FORMANT_COUNT; i++) {
    const t = tweaks[i] ?? IDENTITY_TWEAK;
    out[i].freq = clamp(out[i].freq * t.freq * scale, FORMANT_LIMITS.freq);
    out[i].bw = clamp(out[i].bw * t.bw, FORMANT_LIMITS.bw);
    out[i].gain = clamp(out[i].gain * t.gain, FORMANT_LIMITS.gain);
  }
}

/** Highest resonance sharpness allowed: keeps very narrow bandwidths from ringing or going unstable. */
export const MAX_Q = 60;

export function formantQ(freq: number, bw: number): number {
  const q = freq / Math.max(bw, 1);
  return q > MAX_Q ? MAX_Q : q;
}

export function clampTweak(t: Partial<FormantTweak> | null | undefined): FormantTweak {
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    freq: clamp(num(t?.freq, 1), TWEAK_LIMITS.freq),
    bw: clamp(num(t?.bw, 1), TWEAK_LIMITS.bw),
    gain: clamp(num(t?.gain, 1), TWEAK_LIMITS.gain),
  };
}
