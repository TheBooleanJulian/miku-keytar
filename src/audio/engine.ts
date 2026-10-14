// Web Audio engine. Knows nothing about React, canvas or pointers.
//
// Graph:  voices -> voiceBus -> dry ------------------> compressor -> master -> mute -> speakers
//                           \-> echo delay -> wet ---/                              \-> analyser
//         (each voice: 3 oscillators -> mix gains -> low-pass filter -> envelope gain)

import { PRESETS, cutoffHz, type PresetId } from "./presets.ts";
import { midiToFreq } from "./pitchmap.ts";

export type EngineState = "idle" | "running" | "suspended" | "error";

export interface EngineSettings {
  volume: number;
  muted: boolean;
  preset: PresetId;
  effects: boolean;
  modulation: boolean;
  glide: boolean;
}

interface Voice {
  oscs: OscillatorNode[];
  mixes: GainNode[];
  filter: BiquadFilterNode;
  env: GainNode;
  brightness: number;
}

interface Graph {
  voiceBus: GainNode;
  master: GainNode;
  mute: GainNode;
  wet: GainNode;
  chorusWet: GainNode;
  reverbWet: GainNode;
  lfoGain: GainNode;
  analyser: AnalyserNode;
}

const OSC_TYPES: OscillatorType[] = ["sine", "triangle", "sawtooth", "square"];
const DETUNE_SIGN = [0, 1, -1, 0];
const VOICE_PEAK = 0.22;
const MAX_VOICES = 10;
const PITCH_TC_SNAP = 0.005; // seconds: short enough to feel instant, long enough to avoid a click
const PITCH_TC_GLIDE = 0.07;
const PARAM_TC = 0.025;
const VIBRATO_CENTS = 14;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function defaultContext(): AudioContext {
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) throw new Error("This browser does not support the Web Audio API.");
  return new Ctor({ latencyHint: "interactive" });
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private voices = new Map<number, Voice>();
  private fading = new Set<Voice>();
  private settings: EngineSettings = {
    volume: 0.7,
    muted: false,
    preset: "square",
    effects: true,
    modulation: false,
    glide: false,
  };
  private failed = false;
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private stateListeners = new Set<(s: EngineState) => void>();
  private stopListeners = new Set<() => void>();
  private createContext: () => AudioContext;

  constructor(createContext: () => AudioContext = defaultContext) {
    this.createContext = createContext;
  }

  // ---- lifecycle ---------------------------------------------------------

  get state(): EngineState {
    if (this.failed) return "error";
    if (!this.ctx) return "idle";
    return this.ctx.state === "running" ? "running" : "suspended"; // "interrupted" (Safari) counts as suspended
  }

  get activeVoiceCount(): number {
    return this.voices.size;
  }

  /** Must be called from a user gesture the first time. Safe to call repeatedly (acts as resume). */
  async init(): Promise<void> {
    if (!this.ctx) {
      try {
        this.build();
      } catch (e) {
        this.failed = true;
        this.emitState();
        throw new Error(e instanceof Error ? e.message : "Audio could not be initialised.");
      }
    }
    this.failed = false;
    try {
      await this.ctx!.resume();
    } catch (e) {
      this.emitState();
      throw new Error(`Audio could not be started (${e instanceof Error ? e.message : "unknown error"}).`);
    }
    this.emitState();
  }

  async resume(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.resume();
    } catch {
      // Needs a user gesture; state stays "suspended" and the UI offers a Resume button.
    }
    this.emitState();
  }

  dispose(): void {
    this.stopAll();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.ctx) {
      this.ctx.onstatechange = null;
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.graph = null;
    this.stateListeners.clear();
    this.stopListeners.clear();
  }

  onState(cb: (s: EngineState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Fires whenever every voice is force-stopped (Stop All, page hidden). */
  onAllStopped(cb: () => void): () => void {
    this.stopListeners.add(cb);
    return () => this.stopListeners.delete(cb);
  }

  // ---- settings ----------------------------------------------------------

  configure(next: EngineSettings): void {
    this.settings = { ...next };
    this.applyGlobal();
  }

  /** Current RMS output level 0..~1, for visuals. */
  getLevel(): number {
    const g = this.graph;
    if (!g || this.voices.size === 0) return 0;
    if (!this.levelBuf) this.levelBuf = new Uint8Array(g.analyser.fftSize);
    g.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.levelBuf.length);
  }

  /** Cutoff in Hz for a brightness value under the current preset (for UI readout). */
  cutoffFor(brightness: number): number {
    return cutoffHz(PRESETS[this.settings.preset], brightness);
  }

  // ---- voices ------------------------------------------------------------

  noteOn(id: number, midi: number, brightness: number): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g || ctx.state !== "running") return;

    this.noteOff(id); // repeated down for the same pointer: release the old voice first
    if (this.voices.size >= MAX_VOICES) {
      const oldest = this.voices.keys().next().value;
      if (oldest !== undefined) this.release(oldest, 0.03);
    }

    const p = PRESETS[this.settings.preset];
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoffHz(p, brightness);
    filter.Q.value = p.q;

    const env = ctx.createGain();
    env.gain.value = 0;
    filter.connect(env);
    env.connect(g.voiceBus);

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
      g.lfoGain.connect(osc.detune);
      osc.start(now);
      oscs.push(osc);
      mixes.push(mix);
    }

    // setTargetAtTime (not a linear ramp) so a release can start from wherever the attack is.
    env.gain.setTargetAtTime(VOICE_PEAK, now, p.attack / 3);
    this.voices.set(id, { oscs, mixes, filter, env, brightness });
  }

  noteMove(id: number, midi: number, brightness: number): void {
    const ctx = this.ctx;
    const v = this.voices.get(id);
    if (!ctx || !v) return;
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const tc = this.settings.glide ? PITCH_TC_GLIDE : PITCH_TC_SNAP;
    for (const osc of v.oscs) osc.frequency.setTargetAtTime(freq, now, tc);
    v.brightness = brightness;
    v.filter.frequency.setTargetAtTime(cutoffHz(PRESETS[this.settings.preset], brightness), now, PARAM_TC);
  }

  noteOff(id: number): void {
    this.release(id, PRESETS[this.settings.preset].release);
  }

  stopAll(): void {
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      // Voices already releasing (e.g. long Ethereal tails) get cut short too.
      for (const v of this.fading) {
        v.env.gain.setTargetAtTime(0, now, 0.01);
        for (const osc of v.oscs) osc.stop(now + 0.1);
      }
      for (const [id] of this.voices) this.release(id, 0.04);
    }
    this.voices.clear();
    for (const cb of this.stopListeners) cb();
  }

  // ---- internals ---------------------------------------------------------

  private release(id: number, seconds: number): void {
    const ctx = this.ctx;
    const v = this.voices.get(id);
    if (!ctx || !v) return;
    this.voices.delete(id);
    const now = ctx.currentTime;
    const tc = Math.max(seconds, 0.02) / 4;
    v.env.gain.setTargetAtTime(0, now, tc);
    const end = now + tc * 9 + 0.02; // ~ -75 dB below peak, then hard stop
    for (const osc of v.oscs) osc.stop(end);
    v.oscs[0].onended = () => this.cleanup(v);
    this.fading.add(v);
  }

  private cleanup(v: Voice): void {
    const lfoGain = this.graph?.lfoGain;
    for (const osc of v.oscs) {
      if (lfoGain) {
        try {
          lfoGain.disconnect(osc.detune);
        } catch {
          // already disconnected
        }
      }
      osc.disconnect();
    }
    for (const m of v.mixes) m.disconnect();
    v.filter.disconnect();
    v.env.disconnect();
    this.fading.delete(v);
  }

  private build(): void {
    const ctx = this.createContext();
    this.ctx = ctx;

    const voiceBus = ctx.createGain();
    const dry = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.27;
    const fbTone = ctx.createBiquadFilter();
    fbTone.type = "lowpass";
    fbTone.frequency.value = 2400;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    // Light chorus: two short delays swept in opposite directions by a slow LFO.
    const chorusWet = ctx.createGain();
    chorusWet.gain.value = 0;
    const chorusLfo = ctx.createOscillator();
    chorusLfo.frequency.value = 0.7;
    [0.019, 0.027].forEach((time, i) => {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = time;
      const depth = ctx.createGain();
      depth.gain.value = i === 0 ? 0.003 : -0.003;
      chorusLfo.connect(depth);
      depth.connect(d.delayTime);
      voiceBus.connect(d);
      d.connect(chorusWet);
    });
    chorusLfo.start();

    // Short reverb: convolution with a synthesised decaying-noise impulse (no sample files).
    const reverb = ctx.createConvolver();
    const irLen = Math.round(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
    }
    reverb.buffer = ir;
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0;
    voiceBus.connect(reverb);
    reverb.connect(reverbWet);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const master = ctx.createGain();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    voiceBus.connect(dry);
    dry.connect(comp);
    voiceBus.connect(delay);
    delay.connect(fbTone);
    fbTone.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(comp);
    chorusWet.connect(comp);
    reverbWet.connect(comp);
    comp.connect(master);
    master.connect(mute);
    mute.connect(analyser);
    mute.connect(ctx.destination);

    // One shared vibrato LFO; each voice taps it into its oscillator detune. Depth 0 = off.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain);
    lfo.start();

    this.graph = { voiceBus, master, mute, wet, chorusWet, reverbWet, lfoGain, analyser };
    ctx.onstatechange = () => this.emitState();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
    this.applyGlobal();
  }

  private applyGlobal(): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const s = this.settings;
    const p = PRESETS[s.preset];
    const now = ctx.currentTime;
    g.master.gain.setTargetAtTime(s.volume * s.volume, now, PARAM_TC); // squared: closer to perceived loudness
    g.mute.gain.setTargetAtTime(s.muted ? 0 : 1, now, PARAM_TC);
    g.wet.gain.setTargetAtTime(s.effects ? p.wet : 0, now, 0.05);
    g.chorusWet.gain.setTargetAtTime(s.effects ? p.chorus : 0, now, 0.05);
    g.reverbWet.gain.setTargetAtTime(s.effects ? p.reverb : 0, now, 0.05);
    g.lfoGain.gain.setTargetAtTime(s.modulation ? VIBRATO_CENTS : 0, now, 0.1);
    // Preset switches apply to notes that are already sounding.
    for (const v of this.voices.values()) {
      for (let i = 0; i < v.mixes.length; i++) v.mixes[i].gain.setTargetAtTime(p.mix[i], now, 0.03);
      for (let i = 1; i < v.oscs.length; i++) v.oscs[i].detune.setTargetAtTime(DETUNE_SIGN[i] * p.detune, now, 0.03);
      v.filter.Q.setTargetAtTime(p.q, now, 0.03);
      v.filter.frequency.setTargetAtTime(cutoffHz(p, v.brightness), now, 0.03);
    }
  }

  private emitState(): void {
    const s = this.state;
    for (const cb of this.stateListeners) cb(s);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stopAll();
    else void this.resume();
  };
}
