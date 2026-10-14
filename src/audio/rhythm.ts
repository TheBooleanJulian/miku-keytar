// Rhythm engine: a 16-step sequencer driving synthesised drums, bass, pad and an arpeggio pluck.
// Scheduling uses a short look-ahead on the AudioContext clock, so timing stays tight even when the
// UI thread is busy. Everything is synthesised; no samples.

import { chordVoicing, pitchAtOrAbove, type Chord } from "./chords.ts";
import { PATTERNS, type Pattern } from "./patterns.ts";
import { midiToFreq } from "./pitchmap.ts";

export type Layer = "drums" | "bass" | "pad" | "arp";
export type RhythmLayers = Record<Layer, boolean>;

export interface RhythmConfig {
  pattern: number;
  bpm: number;
  layers: RhythmLayers;
}

export interface RhythmTarget {
  ctx: AudioContext;
  out: AudioNode;
}

interface PadVoice {
  release(when: number, timeConstant: number): void;
}

const LOOKAHEAD = 0.12; // seconds scheduled ahead of the audio clock
const TICK_MS = 25;
const STEPS = 16;
const LAYER_LEVEL: Record<Layer, number> = { drums: 0.9, bass: 0.8, pad: 0.6, arp: 0.6 };
const LAYERS: Layer[] = ["drums", "bass", "pad", "arp"];

const hitVelocity = (c: string): number => (c === "x" ? 1 : c === "o" ? 0.45 : 0);
const chordKey = (c: Chord): string => `${c.rootPc}:${c.pcs.join(",")}`;

export class RhythmEngine {
  private getTarget: () => RhythmTarget | null;
  private getChord: () => Chord | null;
  private cfg: RhythmConfig = {
    pattern: 0,
    bpm: PATTERNS[0].bpm,
    layers: { drums: true, bass: true, pad: true, arp: true },
  };
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layerOut = {} as Record<Layer, GainNode>;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private pad: PadVoice | null = null;
  private padKey = "";

  constructor(getTarget: () => RhythmTarget | null, getChord: () => Chord | null) {
    this.getTarget = getTarget;
    this.getChord = getChord;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  configure(cfg: RhythmConfig): void {
    this.cfg = { pattern: cfg.pattern, bpm: cfg.bpm, layers: { ...cfg.layers } };
  }

  /** Returns false if audio is not available yet. */
  start(): boolean {
    if (this.timer) return true;
    const target = this.getTarget();
    if (!target) return false;
    const { ctx } = target;
    if (this.ctx !== ctx || !this.master) this.build(target);
    const now = ctx.currentTime;
    const master = this.master!;
    // Mute until any hits left over from a previous run (<= look-ahead) have passed.
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.setTargetAtTime(1, now + LOOKAHEAD + 0.01, 0.01);
    this.step = 0;
    this.nextTime = now + LOOKAHEAD + 0.03;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(0, now, 0.01); // also silences hits already scheduled
    this.releasePad(now, 0.05);
    this.step = 0;
  }

  /** Schedules every step due within the look-ahead window. Called by the timer; public for tests. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    const stepDur = 60 / this.cfg.bpm / 4;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % STEPS;
    }
  }

  // ---- sequencing --------------------------------------------------------

  private scheduleStep(step: number, t0: number, stepDur: number): void {
    const p: Pattern = PATTERNS[this.cfg.pattern] ?? PATTERNS[0];
    const t = step % 2 === 1 ? t0 + p.swing * stepDur : t0;
    const on = this.cfg.layers;

    if (on.drums) {
      const k = hitVelocity(p.kick[step]);
      if (k) this.kick(t, k);
      const s = hitVelocity(p.snare[step]);
      if (s) this.snare(t, s);
      const h = hitVelocity(p.hat[step]);
      if (h) this.hat(t, h, false);
      const o = hitVelocity(p.open[step]);
      if (o) this.hat(t, o, true);
    }

    const chord = this.getChord();
    if (!chord) {
      this.releasePad(t, 0.12); // no chord chosen yet: harmony layers wait
      return;
    }

    if (on.bass && p.bass[step] !== ".") {
      let len = 1;
      while (len < STEPS && p.bass[(step + len) % STEPS] === ".") len++;
      const root = pitchAtOrAbove(chord.pcs[0], 28);
      const fifth = (chord.pcs[2] - chord.pcs[0] + 12) % 12;
      const offset = p.bass[step] === "5" ? fifth : p.bass[step] === "8" ? 12 : 0;
      this.bass(t, root + offset, len * stepDur * 0.92);
    }

    if (on.arp && p.arp[step] !== ".") {
      const tones = chordVoicing(chord, 60);
      if (tones.length < 4) tones.push(tones[0] + 12);
      this.pluck(t, tones[Number(p.arp[step]) % tones.length]);
    }

    this.padStep(step, t, p, chord, stepDur, on.pad);
  }

  private padStep(step: number, t: number, p: Pattern, chord: Chord, stepDur: number, enabled: boolean): void {
    if (!enabled) {
      this.releasePad(t, 0.12);
      return;
    }
    if (p.pad[0] === "S") {
      const key = chordKey(chord);
      if (step === 0 || key !== this.padKey || !this.pad) {
        this.releasePad(t, 0.25);
        this.pad = this.buildPad(chordVoicing(chord, 52), t, 0.12, null);
        this.padKey = key;
      }
      return;
    }
    this.releasePad(t, 0.05); // switched from a sustained pattern
    if (p.pad[step] === "x") this.buildPad(chordVoicing(chord, 52), t, 0.01, t + stepDur * 2);
  }

  private releasePad(when: number, timeConstant: number): void {
    if (this.pad) this.pad.release(when, timeConstant);
    this.pad = null;
    this.padKey = "";
  }

  // ---- synthesis ---------------------------------------------------------

  private build(target: RhythmTarget): void {
    const { ctx, out } = target;
    this.ctx = ctx;
    const master = ctx.createGain();
    master.connect(out);
    this.master = master;
    for (const layer of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = LAYER_LEVEL[layer];
      g.connect(master);
      this.layerOut[layer] = g;
    }
    const len = Math.max(1, Math.round(ctx.sampleRate));
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
  }

  /** Gain envelope: fast linear attack, exponential decay. */
  private env(g: GainNode, t: number, peak: number, attack: number, decayTc: number): void {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decayTc);
  }

  private kick(t: number, vel: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, vel * 0.9, 0.002, 0.09);
    o.connect(g);
    g.connect(this.layerOut.drums);
    o.onended = () => g.disconnect();
    o.start(t);
    o.stop(t + 0.5);
  }

  private noiseSource(t: number, length: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + length);
    return src;
  }

  private snare(t: number, vel: number): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, 0.25);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;
    const g = ctx.createGain();
    this.env(g, t, vel * 0.45, 0.001, 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.layerOut.drums);
    src.onended = () => g.disconnect();

    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = 185;
    const bg = ctx.createGain();
    this.env(bg, t, vel * 0.3, 0.001, 0.035);
    body.connect(bg);
    bg.connect(this.layerOut.drums);
    body.onended = () => bg.disconnect();
    body.start(t);
    body.stop(t + 0.2);
  }

  private hat(t: number, vel: number, open: boolean): void {
    const ctx = this.ctx!;
    const src = this.noiseSource(t, open ? 0.5 : 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    this.env(g, t, vel * (open ? 0.2 : 0.22), 0.001, open ? 0.09 : 0.015);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.layerOut.drums);
    src.onended = () => g.disconnect();
  }

  private bass(t: number, midi: number, dur: number): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.setTargetAtTime(220, t, 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.008);
    g.gain.setTargetAtTime(0, t + dur, 0.05);
    filter.connect(g);
    g.connect(this.layerOut.bass);
    const types: OscillatorType[] = ["sawtooth", "sine"];
    types.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiToFreq(midi);
      o.connect(filter);
      if (i === 0) o.onended = () => g.disconnect();
      o.start(t);
      o.stop(t + dur + 0.4);
    });
  }

  private pluck(t: number, midi: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = midiToFreq(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3500, t);
    filter.frequency.setTargetAtTime(700, t, 0.06);
    const g = ctx.createGain();
    this.env(g, t, 0.2, 0.003, 0.12);
    o.connect(filter);
    filter.connect(g);
    g.connect(this.layerOut.arp);
    o.onended = () => g.disconnect();
    o.start(t);
    o.stop(t + 0.7);
  }

  /** Detuned saw pad through a low-pass. `endAt` null = sustains until release() is called. */
  private buildPad(midis: number[], t: number, attackTc: number, endAt: number | null): PadVoice {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1300;
    filter.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(0.3, t, attackTc);
    filter.connect(g);
    g.connect(this.layerOut.pad);
    const oscs: OscillatorNode[] = [];
    for (const m of midis) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiToFreq(m);
        o.detune.value = detune;
        const lvl = ctx.createGain();
        lvl.gain.value = 1 / (midis.length * 2);
        o.connect(lvl);
        lvl.connect(filter);
        o.start(t);
        oscs.push(o);
      }
    }
    let released = false;
    const release = (when: number, tc: number): void => {
      if (released) return;
      released = true;
      g.gain.setTargetAtTime(0, when, tc);
      const stopAt = when + tc * 9 + 0.05;
      for (const o of oscs) o.stop(stopAt);
    };
    oscs[0].onended = () => g.disconnect();
    if (endAt !== null) release(endAt, 0.08);
    return { release };
  }
}
