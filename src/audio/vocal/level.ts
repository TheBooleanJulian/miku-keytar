// Automatic loudness compensation for the vocal voice. Pure maths, no Web Audio.
//
// A pulse train keeps most of its energy in the fundamental, so a note whose pitch lands on a formant (say G4
// against the first formant of う) is several times louder than its neighbours. Rather than a fixed per-vowel
// trim, the voice predicts its own output level from the harmonic series passed through its actual filter bank
// and scales the bank to a fixed target. That keeps loudness steady across pitch, vowel, brightness and edits,
// and makes the A/B comparison with the lead fair. The prediction ignores the noise (breath) component.

import { formantQ, type Formant } from "./formants.ts";
import { brightnessToCutoff, type VocalParams } from "./params.ts";

const MAX_HARMONICS = 80;
const MAX_FREQ = 12000;
const SAW_LEVEL = 0.5;
const SINE_LEVEL = 0.8;

/** Gain limits so extreme edits (e.g. every formant muted) cannot cause a runaway boost. */
export const MIN_LEVEL_GAIN = 0.15;
export const MAX_LEVEL_GAIN = 12;

/**
 * Target for the predicted level. Calibrated against the real engine in Edge (master analyser RMS, effects off,
 * volume 1, notes C3-E5, all five vowels): with a target of 1 the vocal measured 0.250 RMS (spread 1.4x over all
 * pitches and vowels) while the Square lead measured 0.168, so 0.168 / 0.250 = 0.67 matches them.
 */
export const LEVEL_TARGET = 0.67;

export { SAW_LEVEL, SINE_LEVEL };

/** Predicted RMS (arbitrary but consistent units) of the voice's bank output for fundamental `f0`. */
export function predictedLevel(f0: number, formants: readonly Formant[], p: VocalParams, brightness: number): number {
  const d = p.pulseWidth;
  const pulseScale = p.pulse / (1 - d); // PeriodicWave is normalised to peak 1: range is [-d, 1-d]
  const cutoff = brightnessToCutoff(brightness);
  const exc = 1 - 0.35 * p.breath;
  const top = Math.min(MAX_HARMONICS, Math.floor(MAX_FREQ / Math.max(f0, 20)));
  let power = 0;
  for (let n = 1; n <= top; n++) {
    const f = n * f0;
    const pulseA = ((2 / (n * Math.PI)) * Math.abs(Math.sin(n * Math.PI * d))) * pulseScale;
    const sawA = (2 / (n * Math.PI)) * p.saw * SAW_LEVEL;
    const sineA = n === 1 ? p.sine * SINE_LEVEL : 0;
    const src = pulseA * pulseA + sawA * sawA + sineA * sineA; // components assumed uncorrelated

    // excitation low-pass (2nd order, Q = 0.5)
    const xl = f / cutoff;
    const lp = 1 / Math.sqrt((1 - xl * xl) ** 2 + (xl / 0.5) ** 2);

    // parallel band-pass bank: complex sum of g_i * H_i(f)
    let re = 0;
    let im = 0;
    for (const fm of formants) {
      const x = f / fm.freq;
      const q = formantQ(fm.freq, fm.bw);
      // H = (jx/q) / (1 - x^2 + jx/q)
      const dr = 1 - x * x;
      const di = x / q;
      const den = dr * dr + di * di;
      re += (fm.gain * (di * di)) / den; // real part of (j di)/(dr + j di) = di^2/den
      im += (fm.gain * (di * dr)) / den; // imaginary part = di*dr/den
    }
    const bank2 = re * re + im * im;
    power += 0.5 * src * bank2 * lp * lp * exc * exc;
  }
  return Math.sqrt(power);
}

/** Gain to apply after the filter bank so the voice lands on the target loudness. */
export function levelGain(f0: number, formants: readonly Formant[], p: VocalParams, brightness: number): number {
  const pred = predictedLevel(f0, formants, p, brightness);
  const g = LEVEL_TARGET / Math.max(pred, 1e-6);
  return g < MIN_LEVEL_GAIN ? MIN_LEVEL_GAIN : g > MAX_LEVEL_GAIN ? MAX_LEVEL_GAIN : g;
}
