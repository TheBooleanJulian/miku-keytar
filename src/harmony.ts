// Chord state shared by the chord bar, the melody surface and the rhythm engine.
// Mutable and non-React on purpose: the melody layer reads it from a timer.

import type { AudioEngine } from "./audio/engine.ts";
import { chordVoicing, diatonicChords, type Chord, type KeyMode } from "./audio/chords.ts";
import { RhythmEngine, type RhythmLayers } from "./audio/rhythm.ts";

export interface HarmonyConfig {
  keyRoot: number;
  keyMode: KeyMode;
  sevenths: boolean;
  chordMode: "rubato" | "rhythm";
  pattern: number;
  bpm: number;
  layers: RhythmLayers;
}

export interface HarmonyState {
  /** Bit n set = chord n is sounding (rubato: held) or latched (rhythm). */
  mask: number;
  rhythmRunning: boolean;
}

/** Chord notes use their own voice-id range so they never collide with pointer ids. */
const CHORD_ID_BASE = 1_000_000;
const CHORD_LEVEL = 0.6;
const CHORD_BRIGHTNESS = 0.5;

interface Held {
  degree: number;
  ids: number[];
}

export class Harmony {
  readonly rhythm: RhythmEngine;
  chords: Chord[] = diatonicChords(0, "major", false);
  private engine: AudioEngine;
  private cfg: HarmonyConfig | null = null;
  private held = new Map<number, Held>(); // pointerId -> sounding chord (rubato)
  private latched = 0; // chord degree driving the rhythm engine
  private listeners = new Set<(s: HarmonyState) => void>();
  private offStop: () => void;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.rhythm = new RhythmEngine(
      () => engine.rhythmTarget(),
      () => this.activeChord(),
    );
    this.offStop = engine.onAllStopped(() => {
      this.held.clear(); // the engine already silenced the voices
      this.rhythm.stop();
      this.emit();
    });
  }

  dispose(): void {
    this.offStop();
    this.rhythm.stop();
    this.listeners.clear();
  }

  onChange(cb: (s: HarmonyState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Chord that currently defines "the harmony": the last chord held (rubato) or the latched one (rhythm). */
  activeChord(): Chord | null {
    if (this.cfg?.chordMode === "rhythm") return this.chords[this.latched] ?? null;
    let last: Held | null = null;
    for (const h of this.held.values()) last = h;
    return last ? this.chords[last.degree] : null;
  }

  /** Pitch classes the melody can snap to, or null when no chord is active. */
  activePcs(): readonly number[] | null {
    return this.activeChord()?.pcs ?? null;
  }

  configure(next: HarmonyConfig): void {
    const prev = this.cfg;
    this.cfg = { ...next, layers: { ...next.layers } };
    if (!prev || prev.keyRoot !== next.keyRoot || prev.keyMode !== next.keyMode || prev.sevenths !== next.sevenths) {
      this.chords = diatonicChords(next.keyRoot, next.keyMode, next.sevenths);
      this.releaseAll();
    }
    if (prev && prev.chordMode !== next.chordMode) {
      this.releaseAll();
      if (next.chordMode === "rubato") this.rhythm.stop();
    }
    this.rhythm.configure({ pattern: next.pattern, bpm: next.bpm, layers: next.layers });
    this.emit();
  }

  press(pointerId: number, degree: number): void {
    if (this.engine.state !== "running" || !this.cfg) return;
    if (this.cfg.chordMode === "rubato") {
      this.release(pointerId);
      const ids: number[] = [];
      chordVoicing(this.chords[degree]).forEach((midi, i) => {
        const id = CHORD_ID_BASE + pointerId * 16 + i;
        this.engine.noteOn(id, midi, CHORD_BRIGHTNESS, CHORD_LEVEL);
        ids.push(id);
      });
      this.held.set(pointerId, { degree, ids });
    } else {
      this.latched = degree; // tapping a chord both selects it and starts the groove
      if (!this.rhythm.running) this.rhythm.start();
    }
    this.emit();
  }

  release(pointerId: number): void {
    const h = this.held.get(pointerId);
    if (!h) return;
    for (const id of h.ids) this.engine.noteOff(id);
    this.held.delete(pointerId);
    this.emit();
  }

  toggleRhythm(): void {
    if (this.rhythm.running) this.rhythm.stop();
    else if (this.engine.state === "running") this.rhythm.start();
    this.emit();
  }

  private releaseAll(): void {
    for (const h of this.held.values()) for (const id of h.ids) this.engine.noteOff(id);
    this.held.clear();
  }

  private emit(): void {
    let mask = 0;
    if (this.cfg?.chordMode === "rhythm") mask = 1 << this.latched;
    else for (const h of this.held.values()) mask |= 1 << h.degree;
    const state: HarmonyState = { mask, rhythmRunning: this.rhythm.running };
    for (const cb of this.listeners) cb(state);
  }
}
