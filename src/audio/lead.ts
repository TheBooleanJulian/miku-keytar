// The original keytar lead voice: sine/triangle/saw/square oscillators -> low-pass (Y axis) -> envelope.
// Extracted unchanged from the engine so vocal voices can share the same voice lifecycle.

import type { Preset } from "./presets.ts";
import { cutoffHz } from "./presets.ts";
import { PARAM_TC, VOICE_PEAK, type VoiceHandle } from "./voice.ts";

const OSC_TYPES: OscillatorType[] = ["sine", "triangle", "sawtooth", "square"];
const DETUNE_SIGN = [0, 1, -1, 0];

export function createLeadVoice(
  ctx: AudioContext,
  out: AudioNode,
  lfoGain: GainNode,
  getPreset: () => Preset,
  freq: number,
  brightness: number,
  level: number,
  now: number,
): VoiceHandle {
  const p = getPreset();
  let y = brightness;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoffHz(p, brightness);
  filter.Q.value = p.q;

  const env = ctx.createGain();
  env.gain.value = 0;
  filter.connect(env);
  env.connect(out);

  const oscs: OscillatorNode[] = [];
  const mixes: GainNode[] = [];
  for (let i = 0; i < OSC_TYPES.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = OSC_TYPES[i];
    osc.frequency.value = freq;
    osc.detune.value = DETUNE_SIGN[i] * p.detune;
    const mix = ctx.createGain();
    mix.gain.value = p.mix[i];
    osc.connect(mix);
    mix.connect(filter);
    lfoGain.connect(osc.detune);
    osc.start(now);
    oscs.push(osc);
    mixes.push(mix);
  }

  // setTargetAtTime (not a linear ramp) so a release can start from wherever the attack is.
  env.gain.setTargetAtTime(VOICE_PEAK * level, now, p.attack / 3);

  return {
    env,
    sources: oscs,
    setPitch(f, t, tc) {
      for (const osc of oscs) osc.frequency.setTargetAtTime(f, t, tc);
    },
    setControl(v, t) {
      y = v;
      filter.frequency.setTargetAtTime(cutoffHz(getPreset(), v), t, PARAM_TC);
    },
    refresh(t) {
      const cur = getPreset();
      for (let i = 0; i < mixes.length; i++) mixes[i].gain.setTargetAtTime(cur.mix[i], t, 0.03);
      for (let i = 1; i < oscs.length; i++) oscs[i].detune.setTargetAtTime(DETUNE_SIGN[i] * cur.detune, t, 0.03);
      filter.Q.setTargetAtTime(cur.q, t, 0.03);
      filter.frequency.setTargetAtTime(cutoffHz(cur, y), t, 0.03);
    },
    releaseSeconds: () => getPreset().release,
    disconnect() {
      for (const osc of oscs) {
        try {
          lfoGain.disconnect(osc.detune);
        } catch {
          // already disconnected
        }
        osc.disconnect();
      }
      for (const m of mixes) m.disconnect();
      filter.disconnect();
      env.disconnect();
    },
  };
}
