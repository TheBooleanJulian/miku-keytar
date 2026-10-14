import { SCALES, type ScaleId } from "./audio/pitchmap.ts";
import { PRESETS, type PresetId } from "./audio/presets.ts";

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
}

const KEY = "miku-keytar:settings:v1";

export function defaultSettings(): Settings {
  let reduced = false;
  try {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // matchMedia unavailable
  }
  return {
    volume: 0.7,
    muted: false,
    root: 0,
    scale: "pentatonic",
    lowOctave: 3,
    octaves: 2,
    glide: false,
    preset: "pure",
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

/** Reads saved preferences, ignoring anything missing or invalid. Never throws. */
export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Record<string, unknown>;
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
    };
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
