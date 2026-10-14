// Pointer handling for the playing surface. High-frequency work lives here (no React state).
// Maps pointer position -> (note, brightness), then drives the audio engine and the renderer.

import type { AudioEngine } from "./audio/engine.ts";
import { nearestChordTone } from "./audio/chords.ts";
import { midiToName, midiToX, xToMidi, type PitchLayout } from "./audio/pitchmap.ts";
import type { Renderer } from "./visuals/renderer.ts";

/** Where the melody learns which chord (if any) is sounding. */
export interface ChordSource {
  activePcs(): readonly number[] | null;
}

interface Touch {
  xn: number; // horizontal position 0..1 (kept so a scale change can re-snap held notes)
  px: number;
  py: number;
  yn: number; // brightness 0..1
  midi: number;
  // chord snapping: the finger counts as "still" while it stays within STILL_RADIUS of the anchor
  ax: number;
  ay: number;
  stillSince: number;
  snapped: boolean;
}

/** Movement (px) the finger may drift while still counting as held in place. */
const STILL_RADIUS = 8;
const SNAP_CHECK_MS = 40;

/** Dead zone at the top/bottom so full bright/soft are easy to reach with a thumb. */
const Y_MARGIN = 0.04;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Instrument {
  private canvas: HTMLCanvasElement;
  private engine: AudioEngine;
  private renderer: Renderer;
  private onReadout: (midi: number, brightness: number) => void;
  private chords: ChordSource;
  private snapEnabled = true;
  private snapDelay = 500;
  private snapTimer: ReturnType<typeof setInterval> | null = null;
  private touches = new Map<number, Touch>();
  private layout: PitchLayout | null = null;
  private rect: DOMRect;
  private rotated = false;
  private readoutQueued = false;
  private readoutMidi = 0;
  private readoutBrightness = 0;
  private offStop: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    engine: AudioEngine,
    renderer: Renderer,
    chords: ChordSource,
    onReadout: (midi: number, brightness: number) => void,
  ) {
    this.canvas = canvas;
    this.engine = engine;
    this.renderer = renderer;
    this.chords = chords;
    this.onReadout = onReadout;
    this.rect = canvas.getBoundingClientRect();
    this.offStop = engine.onAllStopped(() => this.clear());
  }

  attach(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("lostpointercapture", this.onUp);
    c.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("resize", this.refreshRect);
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("lostpointercapture", this.onUp);
    c.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.refreshRect);
    this.offStop();
    this.stopSnapTimer();
    for (const id of this.touches.keys()) this.engine.noteOff(id);
    this.touches.clear();
  }

  setSnap(enabled: boolean, delayMs: number): void {
    this.snapEnabled = enabled;
    this.snapDelay = delayMs;
  }

  /** New scale/root/range: re-snap fingers that are already down. */
  setLayout(layout: PitchLayout): void {
    this.layout = layout;
    for (const [id, t] of this.touches) {
      t.snapped = false; // the next snap check re-applies chord snapping if it is due
      const midi = xToMidi(layout, t.xn);
      if (midi === t.midi) continue;
      t.midi = midi;
      this.engine.noteMove(id, midi, t.yn);
      this.renderer.setTrailNote(id, this.noteX(midi), midiToName(midi));
    }
  }

  /** Forget all held pointers (after Stop All / page hidden). */
  private clear(): void {
    this.touches.clear();
    this.stopSnapTimer();
    this.renderer.endAll();
  }

  /** Column position for a note; chord tones can fall just outside the on-screen range, so clamp. */
  private noteX(midi: number): number {
    return clamp01(midiToX(this.layout!, midi));
  }

  private startSnapTimer(): void {
    if (!this.snapTimer) this.snapTimer = setInterval(this.checkSnap, SNAP_CHECK_MS);
  }

  private stopSnapTimer(): void {
    if (this.snapTimer) clearInterval(this.snapTimer);
    this.snapTimer = null;
  }

  /**
   * A finger that has stayed (nearly) still for `snapDelay` ms while a chord is sounding is retuned to the
   * nearest chord tone. Moving again returns it to normal scale pitch; releasing the chord un-snaps it.
   */
  private checkSnap = (): void => {
    const layout = this.layout;
    if (!layout) return;
    const pcs = this.snapEnabled ? this.chords.activePcs() : null;
    const now = performance.now();
    for (const [id, t] of this.touches) {
      let target: number;
      if (pcs && now - t.stillSince >= this.snapDelay) {
        target = nearestChordTone(xToMidi(layout, t.xn), pcs);
        t.snapped = true;
      } else if (t.snapped && !pcs) {
        target = xToMidi(layout, t.xn);
        t.snapped = false;
      } else {
        continue;
      }
      if (target === t.midi) continue;
      t.midi = target;
      this.engine.noteMove(id, target, t.yn);
      this.renderer.setTrailNote(id, this.noteX(target), midiToName(target));
      this.queueReadout(t);
    }
  };

  private refreshRect = (): void => {
    this.rect = this.canvas.getBoundingClientRect();
  };

  /** The app is rotated 90° clockwise on screen: map screen coords back into canvas space. */
  setRotated(rotated: boolean): void {
    this.rotated = rotated;
    this.refreshRect();
  }

  private read(e: PointerEvent, t: Touch): void {
    const r = this.rect;
    let w = r.width;
    let h = r.height;
    if (this.rotated) {
      // the rect is the rotated bounding box, so canvas width/height swap
      t.px = e.clientY - r.top;
      t.py = r.right - e.clientX;
      w = r.height;
      h = r.width;
    } else {
      t.px = e.clientX - r.left;
      t.py = e.clientY - r.top;
    }
    t.xn = clamp01(t.px / w);
    t.yn = clamp01((1 - t.py / h - Y_MARGIN) / (1 - 2 * Y_MARGIN));
    t.midi = xToMidi(this.layout!, t.xn);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.layout || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    this.refreshRect();
    const id = e.pointerId;
    if (this.touches.has(id)) this.finish(id);
    try {
      this.canvas.setPointerCapture(id);
    } catch {
      // pointer already gone
    }
    const t: Touch = { xn: 0, px: 0, py: 0, yn: 0, midi: 0, ax: 0, ay: 0, stillSince: 0, snapped: false };
    this.read(e, t);
    t.ax = t.px;
    t.ay = t.py;
    t.stillSince = performance.now();
    this.touches.set(id, t);
    this.engine.noteOn(id, t.midi, t.yn);
    this.renderer.startTrail(id, t.px, t.py, t.yn, this.noteX(t.midi), midiToName(t.midi));
    this.queueReadout(t);
    this.startSnapTimer();
  };

  private onMove = (e: PointerEvent): void => {
    const t = this.touches.get(e.pointerId);
    if (!t || !this.layout) return;
    e.preventDefault();
    const held = t.snapped ? t.midi : 0;
    this.read(e, t);
    const dx = t.px - t.ax;
    const dy = t.py - t.ay;
    if (dx * dx + dy * dy > STILL_RADIUS * STILL_RADIUS) {
      t.ax = t.px; // really moved: back to scale pitch, restart the stillness timer
      t.ay = t.py;
      t.stillSince = performance.now();
      t.snapped = false;
    } else if (t.snapped) {
      t.midi = held; // jitter while snapped keeps the chord tone
    }
    this.engine.noteMove(e.pointerId, t.midi, t.yn);
    this.renderer.moveTrail(e.pointerId, t.px, t.py, t.yn, this.noteX(t.midi), midiToName(t.midi));
    this.queueReadout(t);
  };

  private onUp = (e: PointerEvent): void => {
    this.finish(e.pointerId);
  };

  private finish(id: number): void {
    if (!this.touches.delete(id)) return;
    if (this.touches.size === 0) this.stopSnapTimer();
    this.engine.noteOff(id);
    this.renderer.endTrail(id);
    try {
      this.canvas.releasePointerCapture(id);
    } catch {
      // capture already released
    }
  }

  private onBlur = (): void => {
    this.engine.stopAll();
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /** At most one readout callback per animation frame. */
  private queueReadout(t: Touch): void {
    this.readoutMidi = t.midi;
    this.readoutBrightness = t.yn;
    if (this.readoutQueued) return;
    this.readoutQueued = true;
    requestAnimationFrame(() => {
      this.readoutQueued = false;
      this.onReadout(this.readoutMidi, this.readoutBrightness);
    });
  }
}
