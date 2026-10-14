// Pointer handling for the playing surface. High-frequency work lives here (no React state).
// Maps pointer position -> (note, brightness), then drives the audio engine and the renderer.

import type { AudioEngine } from "./audio/engine.ts";
import { midiToName, midiToX, xToMidi, type PitchLayout } from "./audio/pitchmap.ts";
import type { Renderer } from "./visuals/renderer.ts";

interface Touch {
  xn: number; // horizontal position 0..1 (kept so a scale change can re-snap held notes)
  px: number;
  py: number;
  yn: number; // brightness 0..1
  midi: number;
}

/** Dead zone at the top/bottom so full bright/soft are easy to reach with a thumb. */
const Y_MARGIN = 0.04;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Instrument {
  private canvas: HTMLCanvasElement;
  private engine: AudioEngine;
  private renderer: Renderer;
  private onReadout: (midi: number, brightness: number) => void;
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
    onReadout: (midi: number, brightness: number) => void,
  ) {
    this.canvas = canvas;
    this.engine = engine;
    this.renderer = renderer;
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
    for (const id of this.touches.keys()) this.engine.noteOff(id);
    this.touches.clear();
  }

  /** New scale/root/range: re-snap fingers that are already down. */
  setLayout(layout: PitchLayout): void {
    this.layout = layout;
    for (const [id, t] of this.touches) {
      const midi = xToMidi(layout, t.xn);
      if (midi === t.midi) continue;
      t.midi = midi;
      this.engine.noteMove(id, midi, t.yn);
      this.renderer.setTrailNote(id, midiToX(layout, midi), midiToName(midi));
    }
  }

  /** Forget all held pointers (after Stop All / page hidden). */
  private clear(): void {
    this.touches.clear();
    this.renderer.endAll();
  }

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
    const t: Touch = { xn: 0, px: 0, py: 0, yn: 0, midi: 0 };
    this.read(e, t);
    this.touches.set(id, t);
    this.engine.noteOn(id, t.midi, t.yn);
    this.renderer.startTrail(id, t.px, t.py, t.yn, midiToX(this.layout, t.midi), midiToName(t.midi));
    this.queueReadout(t);
  };

  private onMove = (e: PointerEvent): void => {
    const t = this.touches.get(e.pointerId);
    if (!t || !this.layout) return;
    e.preventDefault();
    this.read(e, t);
    this.engine.noteMove(e.pointerId, t.midi, t.yn);
    this.renderer.moveTrail(e.pointerId, t.px, t.py, t.yn, midiToX(this.layout, t.midi), midiToName(t.midi));
    this.queueReadout(t);
  };

  private onUp = (e: PointerEvent): void => {
    this.finish(e.pointerId);
  };

  private finish(id: number): void {
    if (!this.touches.delete(id)) return;
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
