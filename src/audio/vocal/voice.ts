// One sung voice: excitation -> vocal tract (parallel formant filters) -> envelope.
//
//   pulse (band-limited PeriodicWave) -+
//   sawtooth ---------------------------+-> exciter -> brightness low-pass -+
//   sine -------------------------------+                                   +-> bank input
//   looped noise -> high-pass -> breath gain --------------------------------+
//
//   bank input -> 5 x [band-pass (formant) -> gain] -> bank output -> envelope -> voice bus
//
// Pitch only moves the three oscillators; the formants are separate filters, so changing pitch never drags the
// vowel with it unless the optional "tracking" stylisation is on. Each voice owns its own vibrato and drift LFOs.

import { PARAM_TC, VOICE_PEAK, type VoiceHandle } from "../voice.ts";
import {
  FORMANT_COUNT,
  formantQ,
  formantScale,
  makeFormants,
  morphInto,
  tweakInto,
} from "./formants.ts";
import { SAW_LEVEL, SINE_LEVEL, levelGain } from "./level.ts";
import {
  brightnessToCutoff,
  effectiveBrightness,
  effectiveVowelPos,
  type VocalAxis,
  type VocalParams,
} from "./params.ts";

export interface VocalSettings {
  params: VocalParams;
  axis: VocalAxis;
}

export interface VocalShared {
  /** Cached band-limited pulse wave for a duty cycle. */
  wave(width: number): PeriodicWave;
  /** Looped white-noise buffer. */
  noise: AudioBuffer;
}

const BREATH_LEVEL = 0.9;
const FORMANT_TC = 0.02; // formant glides: quick but click-free
const PITCH_EPS = 0.002; // ignore formant-scale changes smaller than this

export function createVocalVoice(
  ctx: AudioContext,
  out: AudioNode,
  shared: VocalShared,
  getSettings: () => VocalSettings,
  freq: number,
  y: number,
  level: number,
  now: number,
): VoiceHandle {
  const s0 = getSettings();
  const p0 = s0.params;
  let yy = y;
  let curFreq = freq;
  let curWidth = p0.pulseWidth;
  let lastScale = formantScale(freq, p0.tracking);
  const t0 = now;
  const fm = makeFormants(); // reused scratch: no allocation on pointer moves

  // --- excitation ---
  const pulse = ctx.createOscillator();
  pulse.setPeriodicWave(shared.wave(p0.pulseWidth));
  const saw = ctx.createOscillator();
  saw.type = "sawtooth";
  const sine = ctx.createOscillator();
  sine.type = "sine";
  const pitched = [pulse, saw, sine];
  for (const o of pitched) o.frequency.value = freq;

  const pulseG = ctx.createGain();
  const sawG = ctx.createGain();
  const sineG = ctx.createGain();
  const exciter = ctx.createGain();
  const tilt = ctx.createBiquadFilter();
  tilt.type = "lowpass";
  tilt.Q.value = 0.5;
  pulse.connect(pulseG);
  saw.connect(sawG);
  sine.connect(sineG);
  pulseG.connect(exciter);
  sawG.connect(exciter);
  sineG.connect(exciter);
  exciter.connect(tilt);

  // --- breath ---
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = shared.noise;
  noiseSrc.loop = true;
  const noiseHP = ctx.createBiquadFilter();
  noiseHP.type = "highpass";
  noiseHP.frequency.value = 700;
  const noiseG = ctx.createGain();
  noiseSrc.connect(noiseHP);
  noiseHP.connect(noiseG);

  // --- vocal tract ---
  const bankIn = ctx.createGain();
  const bankOut = ctx.createGain();
  tilt.connect(bankIn);
  noiseG.connect(bankIn);
  const bands: BiquadFilterNode[] = [];
  const bandGains: GainNode[] = [];
  for (let i = 0; i < FORMANT_COUNT; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    const g = ctx.createGain();
    bankIn.connect(bp);
    bp.connect(g);
    g.connect(bankOut);
    bands.push(bp);
    bandGains.push(g);
  }

  const env = ctx.createGain();
  env.gain.value = 0;
  bankOut.connect(env);
  env.connect(out);

  // --- per-voice modulation ---
  const vib = ctx.createOscillator();
  vib.type = "sine";
  const vibG = ctx.createGain();
  vibG.gain.value = 0;
  const drift = ctx.createOscillator();
  drift.type = "sine";
  drift.frequency.value = 0.23 + Math.random() * 0.4; // each voice drifts at its own slow rate
  const driftG = ctx.createGain();
  vib.connect(vibG);
  drift.connect(driftG);
  for (const o of pitched) {
    vibG.connect(o.detune);
    driftG.connect(o.detune);
  }

  // --- parameter application ---
  const peak = (p: VocalParams) => VOICE_PEAK * level * p.sustain;

  function applyFormants(t: number, tc: number): void {
    const s = getSettings();
    morphInto(fm, effectiveVowelPos(s.params.vowelPos, yy, s.axis));
    lastScale = formantScale(curFreq, s.params.tracking);
    tweakInto(fm, s.params.tweaks, lastScale);
    for (let i = 0; i < FORMANT_COUNT; i++) {
      bands[i].frequency.setTargetAtTime(fm[i].freq, t, tc);
      bands[i].Q.setTargetAtTime(formantQ(fm[i].freq, fm[i].bw), t, tc);
      bandGains[i].gain.setTargetAtTime(fm[i].gain, t, tc);
    }
    applyLevel(t, tc);
  }

  /** Keeps loudness steady across pitch, vowel and edits (see level.ts). Uses the formants last written to `fm`. */
  function applyLevel(t: number, tc: number): void {
    const s = getSettings();
    const eb = effectiveBrightness(s.params.brightness, yy, s.axis);
    bankOut.gain.setTargetAtTime(levelGain(curFreq, fm, s.params, eb), t, tc);
  }

  function scheduleVibrato(p: VocalParams, t: number): void {
    vibG.gain.cancelScheduledValues(t);
    vib.frequency.setTargetAtTime(p.vibratoRate, t, 0.1);
    const onset = t0 + p.vibratoDelay;
    if (t >= onset) {
      vibG.gain.setTargetAtTime(p.vibratoDepth, t, 0.1);
    } else {
      vibG.gain.setValueAtTime(0, t);
      vibG.gain.setValueAtTime(0, onset);
      vibG.gain.linearRampToValueAtTime(p.vibratoDepth, onset + 0.25);
    }
  }

  // initial state: set values directly (no ramp from defaults), then start
  {
    const eb = effectiveBrightness(p0.brightness, yy, s0.axis);
    pulseG.gain.value = p0.pulse;
    sawG.gain.value = p0.saw * SAW_LEVEL;
    sineG.gain.value = p0.sine * SINE_LEVEL;
    exciter.gain.value = 1 - 0.35 * p0.breath;
    noiseG.gain.value = p0.breath * BREATH_LEVEL;
    tilt.frequency.value = brightnessToCutoff(eb);
    vib.frequency.value = p0.vibratoRate;
    driftG.gain.value = p0.jitter;
    morphInto(fm, effectiveVowelPos(p0.vowelPos, yy, s0.axis));
    tweakInto(fm, p0.tweaks, lastScale);
    for (let i = 0; i < FORMANT_COUNT; i++) {
      bands[i].frequency.value = fm[i].freq;
      bands[i].Q.value = formantQ(fm[i].freq, fm[i].bw);
      bandGains[i].gain.value = fm[i].gain;
    }
    bankOut.gain.value = levelGain(freq, fm, p0, eb);
    scheduleVibrato(p0, now);
    for (const o of pitched) o.start(now);
    noiseSrc.start(now, Math.random() * 0.9);
    vib.start(now);
    drift.start(now);
    // setTargetAtTime (not a ramp) so a release can start from wherever the attack is.
    env.gain.setTargetAtTime(peak(p0), now, p0.attack / 3);
  }

  return {
    env,
    sources: [pulse, saw, sine, noiseSrc, vib, drift],
    setPitch(f, t, tc) {
      curFreq = f;
      for (const o of pitched) o.frequency.setTargetAtTime(f, t, tc);
      const tracking = getSettings().params.tracking;
      if (tracking > 0 && Math.abs(formantScale(f, tracking) - lastScale) > PITCH_EPS) applyFormants(t, FORMANT_TC);
      else applyLevel(t, FORMANT_TC); // the formants stay put, but loudness depends on where the harmonics land
    },
    setControl(v, t) {
      yy = v;
      const s = getSettings();
      applyFormants(t, FORMANT_TC);
      tilt.frequency.setTargetAtTime(
        brightnessToCutoff(effectiveBrightness(s.params.brightness, v, s.axis)),
        t,
        PARAM_TC,
      );
    },
    refresh(t) {
      const s = getSettings();
      const p = s.params;
      if (Math.abs(p.pulseWidth - curWidth) > 1e-6) {
        pulse.setPeriodicWave(shared.wave(p.pulseWidth));
        curWidth = p.pulseWidth;
      }
      pulseG.gain.setTargetAtTime(p.pulse, t, 0.03);
      sawG.gain.setTargetAtTime(p.saw * SAW_LEVEL, t, 0.03);
      sineG.gain.setTargetAtTime(p.sine * SINE_LEVEL, t, 0.03);
      exciter.gain.setTargetAtTime(1 - 0.35 * p.breath, t, 0.03);
      noiseG.gain.setTargetAtTime(p.breath * BREATH_LEVEL, t, 0.03);
      tilt.frequency.setTargetAtTime(brightnessToCutoff(effectiveBrightness(p.brightness, yy, s.axis)), t, 0.03);
      driftG.gain.setTargetAtTime(p.jitter, t, 0.1);
      scheduleVibrato(p, t);
      applyFormants(t, 0.03);
      env.gain.setTargetAtTime(peak(p), t, 0.03);
    },
    releaseSeconds: () => getSettings().params.release,
    disconnect() {
      for (const n of [
        pulse, saw, sine, pulseG, sawG, sineG, exciter, tilt, noiseSrc, noiseHP, noiseG, bankIn, bankOut,
        env, vib, vibG, drift, driftG, ...bands, ...bandGains,
      ]) {
        n.disconnect();
      }
    },
  };
}
