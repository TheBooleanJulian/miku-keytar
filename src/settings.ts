import type { KeyMode } from "./audio/chords.ts";
import { PATTERNS } from "./audio/patterns.ts";
import { SCALES, type ScaleId } from "./audio/pitchmap.ts";
import type { RhythmLayers } from "./audio/rhythm.ts";
import { PRESETS, type PresetId } from "./audio/presets.ts";
import type { Instrument } from "./audio/engine.ts";
import {
  BUILTIN_VOCAL,
  cloneVocal,
  sanitizeVocal,
  type VocalAxis,
  type VocalParams,
} from "./audio/vocal/params.ts";
import { vowelPosition } from "./audio/vocal/formants.ts";
import { USER_PREFIX } from "./vocalStore.ts";

export interface Settings {
  volume: number;
  muted: boolean;
  root: number; // 0..11 pitch class, C = 0
  scale: ScaleId;
  lowOctave: number; // octave of the lowest note (scientific pitch: C4 = middle C)
  octaves: number;
  glide: boolean;
  preset: PresetId;
  effects: boolean;
  modulation: boolean;
  guides: boolean;
  reduced: boolean;
  /** Layout the instrument is drawn in. If the screen disagrees, the app is rotated 90° to match. */
  orientation: "landscape" | "portrait";
  // chords
  keyRoot: number; // 0..11
  keyMode: KeyMode;
  sevenths: boolean;
  chordMode: "rubato" | "rhythm";
  chordSnap: boolean; // snap held melody notes to chord tones
  snapDelay: number; // ms a finger must stay still before it snaps
  // rhythm
  pattern: number; // index into PATTERNS
  bpm: number;
  layers: RhythmLayers;
  rhythmVolume: number;
  // vocal instrument
  instrument: Instrument; // "lead" is the original keytar sound; nothing changes unless the user picks "vocal"
  vocal: VocalParams; // the tuner's working (edited) parameters
  vocalPreset: string; // "bright" | "soft" | "electronic" | "user:<name>": the base the edits started from
  vocalCompare: "edited" | "default"; // A/B: play the edits, or the untouched preset
  vocalAxis: VocalAxis;
  /** Marks that `vocal.vowelPos` uses the あ い う え お order (it was う お あ え い before). */
  vowelOrder: "aiueo";
  auditionNote: number; // MIDI note played by the tuner's audition button
}

const KEY = "miku-keytar:settings:v1";

export function defaultSettings(): Settings {
  let reduced = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // matchMedia unavailable
  }
  let coarse = false; // touch-first device (phone / tablet)
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    // matchMedia unavailable
  }
  return {
    // Phones start in landscape even when held upright; desktop just matches its window.
    orientation:
      coarse || typeof window === "undefined" || window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
    instrument: "lead",
    vocal: cloneVocal(BUILTIN_VOCAL.miku.params), // fresh installs start on the reference-fitted preset
    vocalPreset: "miku",
    vocalCompare: "edited",
    vocalAxis: "morph",
    vowelOrder: "aiueo",
    auditionNote: 60,
    keyRoot: 0,
    keyMode: "major",
    sevenths: false,
    chordMode: "rubato",
    chordSnap: true,
    snapDelay: 500,
    pattern: 0,
    bpm: PATTERNS[0].bpm,
    layers: { drums: true, bass: true, pad: true, arp: true },
    rhythmVolume: 0.7,
    volume: 0.7,
    muted: false,
    root: 0,
    scale: "pentatonic",
    lowOctave: 3,
    octaves: 2,
    glide: false,
    preset: "square",
    effects: true,
    modulation: false,
    guides: true,
    reduced,
  };
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

const OLD_MORPH_ORDER = ["u", "o", "a", "e", "i"] as const;

/**
 * Vocal parameters and the preset they came from. Edits saved before per-vowel tweaks existed (no `vowelTweaks`
 * field) carry the old global formant cuts that dulled い and え, so they are replaced by their built-in preset
 * instead of being carried forward. Everything saved since is kept and sanitised as usual.
 */
function migrateVocal(s: Record<string, unknown>, d: Settings): Pick<Settings, "vocal" | "vocalPreset"> {
  const id = s.vocalPreset;
  const valid =
    typeof id === "string" && (id in BUILTIN_VOCAL || (id.startsWith(USER_PREFIX) && id.length <= 40));
  const preset = valid ? (id as string) : d.vocalPreset;
  const hasPerVowel = typeof s.vocal === "object" && s.vocal !== null && "vowelTweaks" in s.vocal;
  if (hasPerVowel || s.vocal === undefined) {
    const vocal = sanitizeVocal(s.vocal, d.vocal);
    // Before the あ い う え お order, vowelPos ran う お あ え い: keep the same vowel by moving to its new position.
    if (s.vowelOrder !== "aiueo" && s.vocal !== undefined) {
      vocal.vowelPos = vowelPosition(OLD_MORPH_ORDER[Math.round(vocal.vowelPos * 4)]);
    }
    return { vocal, vocalPreset: preset };
  }
  return preset in BUILTIN_VOCAL
    ? { vocal: cloneVocal(BUILTIN_VOCAL[preset as keyof typeof BUILTIN_VOCAL].params), vocalPreset: preset }
    : { vocal: d.vocal, vocalPreset: d.vocalPreset }; // a user preset's old edits cannot be rebuilt here
}

/** Validates a parsed settings object field by field; anything missing or invalid takes the default. */
export function parseSettings(s: Record<string, unknown>, d: Settings): Settings {
    const layers = (typeof s.layers === "object" && s.layers !== null ? s.layers : {}) as Record<string, unknown>;
    return {
      volume: typeof s.volume === "number" && s.volume >= 0 && s.volume <= 1 ? s.volume : d.volume,
      muted: bool(s.muted, d.muted),
      root: int(s.root, 0, 11, d.root),
      scale: typeof s.scale === "string" && s.scale in SCALES ? (s.scale as ScaleId) : d.scale,
      lowOctave: int(s.lowOctave, 1, 5, d.lowOctave),
      octaves: int(s.octaves, 1, 4, d.octaves),
      glide: bool(s.glide, d.glide),
      preset: typeof s.preset === "string" && s.preset in PRESETS ? (s.preset as PresetId) : d.preset,
      effects: bool(s.effects, d.effects),
      modulation: bool(s.modulation, d.modulation),
      guides: bool(s.guides, d.guides),
      reduced: bool(s.reduced, d.reduced),
      orientation: s.orientation === "landscape" || s.orientation === "portrait" ? s.orientation : d.orientation,
      keyRoot: int(s.keyRoot, 0, 11, d.keyRoot),
      keyMode: s.keyMode === "major" || s.keyMode === "minor" ? s.keyMode : d.keyMode,
      sevenths: bool(s.sevenths, d.sevenths),
      chordMode: s.chordMode === "rubato" || s.chordMode === "rhythm" ? s.chordMode : d.chordMode,
      chordSnap: bool(s.chordSnap, d.chordSnap),
      snapDelay: int(s.snapDelay, 150, 2000, d.snapDelay),
      pattern: int(s.pattern, 0, PATTERNS.length - 1, d.pattern),
      bpm: int(s.bpm, 50, 200, d.bpm),
      layers: {
        drums: bool(layers.drums, true),
        bass: bool(layers.bass, true),
        pad: bool(layers.pad, true),
        arp: bool(layers.arp, true),
      },
      rhythmVolume: typeof s.rhythmVolume === "number" && s.rhythmVolume >= 0 && s.rhythmVolume <= 1 ? s.rhythmVolume : d.rhythmVolume,
      instrument: s.instrument === "vocal" || s.instrument === "lead" ? s.instrument : d.instrument,
      ...migrateVocal(s, d),
      vocalCompare: s.vocalCompare === "default" || s.vocalCompare === "edited" ? s.vocalCompare : d.vocalCompare,
      vocalAxis: s.vocalAxis === "morph" || s.vocalAxis === "fixed" ? s.vocalAxis : d.vocalAxis,
      vowelOrder: "aiueo",
      auditionNote: int(s.auditionNote, 36, 96, d.auditionNote),
    };
}

/** Reads saved preferences, ignoring anything missing or invalid. Never throws. */
export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    return parseSettings(JSON.parse(raw) as Record<string, unknown>, d);
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode / storage blocked: the instrument works without persistence
  }
}
