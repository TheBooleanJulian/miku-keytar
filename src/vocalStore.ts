// User-saved vocal presets, kept in the browser's localStorage under their own key so they can never touch the
// built-in keytar presets or the main settings. All functions take the storage as a parameter for testing.

import {
  BUILTIN_VOCAL,
  cloneVocal,
  defaultVocal,
  sanitizeVocal,
  type BuiltinVocalId,
  type VocalParams,
} from "./audio/vocal/params.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type UserPresets = Record<string, VocalParams>;

const KEY = "miku-keytar:vocal-presets:v1";
export const MAX_USER_PRESETS = 20;
export const MAX_NAME_LENGTH = 24;
export const USER_PREFIX = "user:";

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // blocked storage: presets simply don't persist
  }
}

/** Trims, collapses whitespace and limits the length. Returns "" if nothing usable is left. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** Reads saved presets, sanitising every one. Never throws. */
export function loadUserPresets(storage: StorageLike | null = browserStorage()): UserPresets {
  const out: UserPresets = {};
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return out;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data !== "object" || data === null) return out;
    for (const [name, value] of Object.entries(data)) {
      const clean = cleanName(name);
      if (clean && Object.keys(out).length < MAX_USER_PRESETS) out[clean] = sanitizeVocal(value);
    }
  } catch {
    // corrupt data: start empty
  }
  return out;
}

function write(presets: UserPresets, storage: StorageLike | null): void {
  try {
    storage?.setItem(KEY, JSON.stringify(presets));
  } catch {
    // storage full or blocked: the in-memory list still works for this session
  }
}

/** Returns the updated list, or null if the name is empty or the list is full (and the name is new). */
export function saveUserPreset(
  presets: UserPresets,
  name: string,
  params: VocalParams,
  storage: StorageLike | null = browserStorage(),
): UserPresets | null {
  const clean = cleanName(name);
  if (!clean) return null;
  if (!(clean in presets) && Object.keys(presets).length >= MAX_USER_PRESETS) return null;
  const next = { ...presets, [clean]: sanitizeVocal(params) };
  write(next, storage);
  return next;
}

export function deleteUserPreset(
  presets: UserPresets,
  name: string,
  storage: StorageLike | null = browserStorage(),
): UserPresets {
  const next = { ...presets };
  delete next[name];
  write(next, storage);
  return next;
}

export function isBuiltin(id: string): id is BuiltinVocalId {
  return id in BUILTIN_VOCAL;
}

/** Looks up a preset id ("bright" or "user:My Voice"); unknown ids fall back to the default Bright Vocal. */
export function resolvePreset(id: string, users: UserPresets): VocalParams {
  if (isBuiltin(id)) return cloneVocal(BUILTIN_VOCAL[id].params);
  if (id.startsWith(USER_PREFIX)) {
    const found = users[id.slice(USER_PREFIX.length)];
    if (found) return cloneVocal(found);
  }
  return defaultVocal();
}
