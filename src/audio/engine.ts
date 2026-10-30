// Web Audio engine. Knows nothing about React, canvas or pointers.
//
// Graph:  voices -> voiceBus -> dry ------------------> compressor -> master -> mute -> speakers
//                           \-> echo delay -> wet ---/         \                    \-> analyser (level)
//                           \-> chorus -> chorusWet -/          \-> spectrum analyser (tuner display)
//                           \-> reverb -> reverbWet /
//         rhythm bus --------------------------------/
//
// A voice is anything implementing VoiceHandle: the original lead synth (lead.ts) or the formant vocal
// (vocal/voice.ts). The engine owns polyphony, release, Stop All and cleanup for both.

import { createLeadVoice } from "./lead.ts";
import { PRESETS, cutoffHz, type PresetId } from "./presets.ts";
import { midiToFreq } from "./pitchmap.ts";
import { PARAM_TC, type VoiceHandle } from "./voice.ts";
import { vowelLabel } from "./vocal/formants.ts";
import { defaultVocal, effectiveVowelPos, pulseWaveCoeffs, type VocalAxis, type VocalParams } from "./vocal/params.ts";
import { createVocalVoice, type VocalSettings, type VocalShared } from "./vocal/voice.ts";

export type EngineState = "idle" | "running" | "suspended" | "error";
export type Instrument = "lead" | "vocal";

export interface EngineSettings {
  volume: number;
  muted: boolean;
  preset: PresetId;
  effects: boolean;
  modulation: boolean;
  glide: boolean;
  /** Level of the rhythm section (drums, bass, pad, arp), 0..1. */
  rhythmVolume: number;
  /** Which instrument new notes use. Notes already sounding keep the instrument they started with. */
  instrument: Instrument;
  /** Vocal parameters in force (the tuner's A/B choice has already been applied by the caller). */
  vocal: VocalParams;
  vocalAxis: VocalAxis;
}

interface Graph {
  voiceBus: GainNode;
  master: GainNode;
  mute: GainNode;
  wet: GainNode;
  chorusWet: GainNode;
  reverbWet: GainNode;
  rhythmBus: GainNode;
  lfoGain: GainNode;
  analyser: AnalyserNode;
  spectrum: AnalyserNode;
}

const MAX_VOICES = 16; // touches + held chord notes
const PITCH_TC_SNAP = 0.005; // seconds: short enough to feel instant, long enough to avoid a click
const PITCH_TC_GLIDE = 0.07;
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
  private voices = new Map<number, VoiceHandle>();
  private fading = new Set<VoiceHandle>();
  private settings: EngineSettings = {
    volume: 0.7,
    muted: false,
    preset: "square",
    effects: true,
    modulation: false,
    glide: false,
    rhythmVolume: 0.7,
    instrument: "lead",
    vocal: defaultVocal(),
    vocalAxis: "morph",
  };
  /** Stable object read by vocal voices, so no allocation per call. */
  private vocalSettings: VocalSettings = { params: this.settings.vocal, axis: this.settings.vocalAxis };
  private vocalShared: VocalShared | null = null;
  private waves = new Map<number, PeriodicWave>();
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
    this.vocalShared = null;
    this.waves.clear();
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
    this.vocalSettings.params = next.vocal;
    this.vocalSettings.axis = next.vocalAxis;
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

  /** Cutoff in Hz for a brightness value under the current lead preset (for the UI readout). */
  cutoffFor(brightness: number): number {
    return cutoffHz(PRESETS[this.settings.preset], brightness);
  }

  /** Text for the live readout describing what the vertical position does under the current instrument. */
  controlLabel(y: number): string {
    const s = this.settings;
    if (s.instrument === "vocal") {
      const pos = effectiveVowelPos(s.vocal.vowelPos, y, s.vocalAxis, s.vocal.vowelHold);
      return `vowel ${vowelLabel(pos)} · ${s.vocalAxis === "morph" ? "morph" : "fixed"} ${Math.round(pos * 100)}%`;
    }
    return `brightness ${Math.round(y * 100)}% · ${Math.round(this.cutoffFor(y))} Hz`;
  }

  // ---- analysis / routing for the tuner and reference player ------------------

  /** Spectrum of the synth output (before master volume and mute). Returns false if audio isn't built yet. */
  readSpectrum(out: Float32Array<ArrayBuffer>): boolean {
    const g = this.graph;
    if (!g || out.length < g.spectrum.frequencyBinCount) return false;
    g.spectrum.getFloatFrequencyData(out);
    return true;
  }

  spectrumInfo(): { bins: number; sampleRate: number; minDb: number; maxDb: number } | null {
    const g = this.graph;
    if (!g || !this.ctx) return null;
    return {
      bins: g.spectrum.frequencyBinCount,
      sampleRate: this.ctx.sampleRate,
      minDb: g.spectrum.minDecibels,
      maxDb: g.spectrum.maxDecibels,
    };
  }

  /** Context and node the reference-audio player plays into (master volume and mute apply). */
  referenceTarget(): { ctx: AudioContext; out: AudioNode } | null {
    return this.ctx && this.graph ? { ctx: this.ctx, out: this.graph.master } : null;
  }

  // ---- voices ------------------------------------------------------------

  /** Context + node the rhythm engine plays into (it bypasses the lead effects, not the compressor). */
  rhythmTarget(): { ctx: AudioContext; out: AudioNode } | null {
    return this.ctx && this.graph ? { ctx: this.ctx, out: this.graph.rhythmBus } : null;
  }

  /** `level` scales the voice's loudness (chords sit under the melody). */
  noteOn(id: number, midi: number, brightness: number, level = 1): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g || ctx.state !== "running") return;

    this.noteOff(id); // repeated down for the same pointer: release the old voice first
    if (this.voices.size >= MAX_VOICES) {
      const oldest = this.voices.keys().next().value;
      if (oldest !== undefined) this.release(oldest, 0.03);
    }

    const now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const voice =
      this.settings.instrument === "vocal" && this.vocalShared
        ? createVocalVoice(ctx, g.voiceBus, this.vocalShared, this.getVocal, freq, brightness, level, now)
        : createLeadVoice(ctx, g.voiceBus, g.lfoGain, this.getPreset, freq, brightness, level, now);
    this.voices.set(id, voice);
  }

  noteMove(id: number, midi: number, brightness: number): void {
    const ctx = this.ctx;
    const v = this.voices.get(id);
    if (!ctx || !v) return;
    const now = ctx.currentTime;
    v.setPitch(midiToFreq(midi), now, this.settings.glide ? PITCH_TC_GLIDE : PITCH_TC_SNAP);
    v.setControl(brightness, now);
  }

  noteOff(id: number): void {
    const v = this.voices.get(id);
    if (v) this.release(id, v.releaseSeconds());
  }

  stopAll(): void {
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      // Voices already releasing (e.g. long Ethereal tails) get cut short too.
      for (const v of this.fading) {
        v.env.gain.setTargetAtTime(0, now, 0.01);
        for (const src of v.sources) src.stop(now + 0.1);
      }
      for (const [id] of this.voices) this.release(id, 0.04);
    }
    this.voices.clear();
    for (const cb of this.stopListeners) cb();
  }

  // ---- internals ---------------------------------------------------------

  private getPreset = () => PRESETS[this.settings.preset];
  private getVocal = (): VocalSettings => this.vocalSettings;

  private release(id: number, seconds: number): void {
    const ctx = this.ctx;
    const v = this.voices.get(id);
    if (!ctx || !v) return;
    this.voices.delete(id);
    const now = ctx.currentTime;
    const tc = Math.max(seconds, 0.02) / 4;
    v.env.gain.setTargetAtTime(0, now, tc);
    const end = now + tc * 9 + 0.02; // ~ -75 dB below peak, then hard stop
    for (const src of v.sources) src.stop(end);
    v.sources[0].onended = () => this.cleanup(v);
    this.fading.add(v);
  }

  private cleanup(v: VoiceHandle): void {
    v.disconnect();
    this.fading.delete(v);
  }

  private wave = (width: number): PeriodicWave => {
    const key = Math.round(width * 1000);
    let w = this.waves.get(key);
    if (!w) {
      const { real, imag } = pulseWaveCoeffs(key / 1000);
      w = this.ctx!.createPeriodicWave(real, imag);
      this.waves.set(key, w);
    }
    return w;
  };

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
    const rhythmBus = ctx.createGain();
    rhythmBus.connect(comp);
    const master = ctx.createGain();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    // Tuner spectrum: tapped before master volume/mute and before the reference player joins at master.
    const spectrum = ctx.createAnalyser();
    spectrum.fftSize = 2048;
    spectrum.smoothingTimeConstant = 0.8;
    spectrum.minDecibels = -100;
    spectrum.maxDecibels = -20;

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
    comp.connect(spectrum);
    master.connect(mute);
    mute.connect(analyser);
    mute.connect(ctx.destination);

    // One shared vibrato LFO for the lead; each lead voice taps it into its oscillator detune. Depth 0 = off.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain);
    lfo.start();

    // Looped white noise shared by every vocal voice's breath source.
    const noise = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate)), ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.vocalShared = { wave: this.wave, noise };

    this.graph = { voiceBus, master, mute, wet, chorusWet, reverbWet, rhythmBus, lfoGain, analyser, spectrum };
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
    // Effect sends follow the current instrument; the vocal has no echo so its timbre stays clear.
    const echo = s.instrument === "vocal" ? 0 : p.wet;
    const chorus = s.instrument === "vocal" ? s.vocal.chorus : p.chorus;
    const reverb = s.instrument === "vocal" ? s.vocal.reverb : p.reverb;
    g.master.gain.setTargetAtTime(s.volume * s.volume, now, PARAM_TC); // squared: closer to perceived loudness
    g.mute.gain.setTargetAtTime(s.muted ? 0 : 1, now, PARAM_TC);
    g.wet.gain.setTargetAtTime(s.effects ? echo : 0, now, 0.05);
    g.rhythmBus.gain.setTargetAtTime(s.rhythmVolume, now, PARAM_TC);
    g.chorusWet.gain.setTargetAtTime(s.effects ? chorus : 0, now, 0.05);
    g.reverbWet.gain.setTargetAtTime(s.effects ? reverb : 0, now, 0.05);
    g.lfoGain.gain.setTargetAtTime(s.modulation ? VIBRATO_CENTS : 0, now, 0.1);
    // Setting changes apply to notes that are already sounding.
    for (const v of this.voices.values()) v.refresh(now);
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
