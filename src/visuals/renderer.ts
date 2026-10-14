// Canvas renderer: note-guide grid + glowing trails. Knows nothing about audio or React.
// Everything the frame loop touches is preallocated (typed-array ring buffers, sprites, trail pool).

import { midiToName, midiToX, type PitchLayout } from "../audio/pitchmap.ts";

const MAX_POINTS = 48;
const MAX_TRAILS = 16;
const PALETTE = ["#00D4C8", "#38E8FF", "#7CF7EA", "#22B8E0", "#9AF5FF", "#4FD1C5", "#67E8F9", "#2DD4BF"];
const BG = "#050508";
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const CYAN = "#22E8FF";
const HOLD_MS = 220; // pressed at least this long = a hold (shows ripples), shorter = a tap (line only)
const FLASH_MS = 600;
const RING_PERIOD = 1300;
const RING_COUNT = 4;
const RIPPLE_FADE_MS = 350;

/** Cyan line through the touch point at a random angle, spawned on every touch. */
class Flash {
  active = false;
  x = 0;
  y = 0;
  angle = 0;
  t0 = 0;
}

class Trail {
  id = -1;
  active = false;
  downT = 0; // when the touch began
  endT = 0; // when it ended (0 while held)
  rot = 0; // random starting rotation for the hold ripples

  color = 0;
  count = 0;
  head = 0; // next write index
  xs = new Float32Array(MAX_POINTS);
  ys = new Float32Array(MAX_POINTS);
  bs = new Float32Array(MAX_POINTS); // brightness 0..1 at each point
  ts = new Float64Array(MAX_POINTS);
  lastT = 0;
  noteX = 0; // normalised x of the snapped note, for the column highlight
  label = "";

  push(x: number, y: number, b: number, t: number): void {
    const i = this.head;
    this.xs[i] = x;
    this.ys[i] = y;
    this.bs[i] = b;
    this.ts[i] = t;
    this.head = (i + 1) % MAX_POINTS;
    if (this.count < MAX_POINTS) this.count++;
    this.lastT = t;
  }
}

function makeSprite(hex: string): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = parseInt(hex.slice(1, 3), 16);
  const gr = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.32, `rgba(${r},${gr},${b},0.45)`);
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private getLevel: () => number;
  private ctx: CanvasRenderingContext2D;
  private grid = document.createElement("canvas");
  private gridCtx: CanvasRenderingContext2D;
  private sprites = PALETTE.map(makeSprite);
  private trails: Trail[] = Array.from({ length: MAX_TRAILS }, () => new Trail());
  private flashes: Flash[] = Array.from({ length: 12 }, () => new Flash());
  private flashCursor = 0;
  private colorCursor = 0;
  private layout: PitchLayout | null = null;
  private guides = true;
  private reduced = false;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private dirty = true;
  private gridDirty = true;
  private raf = 0;
  private observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, getLevel: () => number) {
    this.canvas = canvas;
    this.getLevel = getLevel;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.gridCtx = this.grid.getContext("2d", { alpha: false })!;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  start(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer.disconnect();
  }

  setLayout(layout: PitchLayout, guides: boolean): void {
    this.layout = layout;
    this.guides = guides;
    this.gridDirty = this.dirty = true;
  }

  setReduced(reduced: boolean): void {
    if (reduced === this.reduced) return;
    this.reduced = reduced;
    this.resize();
  }

  // ---- trails ------------------------------------------------------------

  startTrail(id: number, x: number, y: number, brightness: number, noteX: number, label: string): void {
    this.endTrail(id);
    const now = performance.now();
    let slot: Trail | null = null;
    let oldest: Trail = this.trails[0];
    for (const t of this.trails) {
      if (!t.active && (t.count === 0 || now - t.lastT > this.life())) {
        slot = t;
        break;
      }
      if (t.lastT < oldest.lastT) oldest = t;
    }
    const tr = slot ?? oldest;
    tr.id = id;
    tr.active = true;
    tr.downT = now;
    tr.endT = 0;
    tr.rot = Math.random() * Math.PI;
    const f = this.flashes[this.flashCursor++ % this.flashes.length];
    f.active = true;
    f.x = x;
    f.y = y;
    f.angle = Math.random() * Math.PI;
    f.t0 = now;
    tr.count = 0;
    tr.head = 0;
    tr.color = this.colorCursor++ % PALETTE.length;
    tr.noteX = noteX;
    tr.label = label;
    tr.push(x, y, brightness, now);
    this.dirty = true;
  }

  moveTrail(id: number, x: number, y: number, brightness: number, noteX: number, label: string): void {
    const tr = this.find(id);
    if (!tr) return;
    tr.noteX = noteX;
    tr.label = label;
    tr.push(x, y, brightness, performance.now());
  }

  setTrailNote(id: number, noteX: number, label: string): void {
    const tr = this.find(id);
    if (tr) {
      tr.noteX = noteX;
      tr.label = label;
    }
  }

  endTrail(id: number): void {
    const tr = this.find(id);
    if (tr) this.release(tr, performance.now()); // points keep fading out on their own
  }

  endAll(): void {
    const now = performance.now();
    for (const t of this.trails) if (t.active) this.release(t, now);
  }

  private release(t: Trail, now: number): void {
    t.active = false;
    t.endT = now;
  }

  private find(id: number): Trail | null {
    for (const t of this.trails) if (t.active && t.id === id) return t;
    return null;
  }

  private life(): number {
    return this.reduced ? 380 : 750;
  }

  // ---- sizing / grid -----------------------------------------------------

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.dpr = this.reduced ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    const pw = Math.round(w * this.dpr);
    const ph = Math.round(h * this.dpr);
    this.canvas.width = this.grid.width = pw;
    this.canvas.height = this.grid.height = ph;
    this.gridDirty = this.dirty = true;
  }

  private drawGrid(): void {
    const g = this.gridCtx;
    const { w, h } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = BG;
    g.fillRect(0, 0, w, h);

    // faint teal wash toward the bright (top) end
    const wash = g.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, "rgba(0,212,200,0.07)");
    wash.addColorStop(0.6, "rgba(0,212,200,0)");
    g.fillStyle = wash;
    g.fillRect(0, 0, w, h);

    g.lineWidth = 1;
    g.strokeStyle = "rgba(0,212,200,0.06)";
    g.beginPath();
    for (let i = 1; i < 8; i++) {
      const y = Math.round((h * i) / 8) + 0.5;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();

    const layout = this.layout;
    if (!layout || !this.guides) return;
    const notes = layout.notes;
    const labelAll = w / notes.length >= 30;
    g.font = `10px ${MONO}`;
    g.textBaseline = "alphabetic";
    g.textAlign = "center";
    for (let i = 0; i < notes.length; i++) {
      const m = notes[i];
      const isRoot = (m - layout.low) % 12 === 0;
      const x = Math.round(midiToX(layout, m) * w) + 0.5;
      g.strokeStyle = isRoot ? "rgba(0,212,200,0.30)" : "rgba(0,212,200,0.10)";
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h - 28); // stop above the note labels
      g.stroke();
      if (isRoot || labelAll) {
        g.fillStyle = isRoot ? "rgba(0,212,200,0.75)" : "rgba(160,235,230,0.45)";
        const tx = Math.min(Math.max(x, 14), w - 14);
        g.fillText(midiToName(m), tx, h - 14);
      }
    }
    g.fillStyle = "rgba(160,235,230,0.35)";
    g.textAlign = "left";
    g.fillText("BRIGHT", 12, 78);
    g.fillText("SOFT", 12, h - 34);
  }

  // ---- frame loop --------------------------------------------------------

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const life = this.life();
    let anyActive = false;
    let anyAlive = false;
    for (const t of this.trails) {
      if (t.count === 0) continue;
      if (t.active) {
        anyActive = true;
        anyAlive = true;
        const last = (t.head - 1 + MAX_POINTS) % MAX_POINTS;
        if (now - t.lastT > 30) t.push(t.xs[last], t.ys[last], t.bs[last], now); // keep a held, still finger glowing
      } else if (now - t.lastT < life) {
        anyAlive = true;
      } else {
        t.count = 0;
        this.dirty = true; // one last redraw to clear it
      }
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      if (now - f.t0 < FLASH_MS) anyAlive = true;
      else {
        f.active = false;
        this.dirty = true;
      }
    }
    if (!anyAlive && !this.dirty) return;
    this.dirty = false;

    if (this.gridDirty) {
      this.drawGrid();
      this.gridDirty = false;
    }

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    c.drawImage(this.grid, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const level = anyActive && !this.reduced ? this.getLevel() : 0;
    const pulse = 1 + Math.min(level * 2.5, 0.5) + (this.reduced ? 0 : 0.05 * Math.sin(now / 170));

    // active note columns
    c.fillStyle = "rgba(0,212,200,0.35)";
    for (const t of this.trails) {
      if (t.active) c.fillRect(Math.round(t.noteX * this.w), 0, 1, this.h);
    }

    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = CYAN;
    for (const f of this.flashes) if (f.active) this.drawFlash(f, now);
    for (const t of this.trails) if (t.count > 0) this.drawRipples(t, now);
    for (const t of this.trails) if (t.count > 0) this.drawTrail(t, now, life, pulse);
    c.globalCompositeOperation = "source-over";

    if (this.guides) {
      c.font = `11px ${MONO}`;
      c.textAlign = "left";
      c.fillStyle = "rgba(210,255,250,0.9)";
      for (const t of this.trails) {
        if (!t.active) continue;
        const last = (t.head - 1 + MAX_POINTS) % MAX_POINTS;
        c.fillText(t.label, t.xs[last] + 18, t.ys[last] - 18);
      }
    }
  };

  private drawFlash(f: Flash, now: number): void {
    const c = this.ctx;
    const age = now - f.t0;
    const grow = Math.min(age / 160, 1);
    const half = 30 + 110 * (1 - (1 - grow) * (1 - grow) * (1 - grow));
    const a = 1 - age / FLASH_MS;
    const dx = Math.cos(f.angle) * half;
    const dy = Math.sin(f.angle) * half;
    c.beginPath();
    c.moveTo(f.x - dx, f.y - dy);
    c.lineTo(f.x + dx, f.y + dy);
    if (!this.reduced) {
      c.lineWidth = 7;
      c.globalAlpha = 0.18 * a;
      c.stroke();
    }
    c.lineWidth = 1.6;
    c.globalAlpha = 0.95 * a;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** Expanding, rotating cyan squares emitted while a touch is held past HOLD_MS. */
  private drawRipples(t: Trail, now: number): void {
    const end = t.active ? now : t.endT;
    if (end - t.downT < HOLD_MS) return;
    const fade = t.active ? 1 : 1 - (now - t.endT) / RIPPLE_FADE_MS;
    if (fade <= 0) return;
    const c = this.ctx;
    const last = (t.head - 1 + MAX_POINTS) % MAX_POINTS;
    const x = t.xs[last] * this.dpr;
    const y = t.ys[last] * this.dpr;
    const rings = this.reduced ? 2 : RING_COUNT;
    const elapsed = now - t.downT - HOLD_MS;
    for (let k = 0; k < rings; k++) {
      const age = elapsed - (k * RING_PERIOD) / rings;
      if (age < 0) continue;
      const phase = (age % RING_PERIOD) / RING_PERIOD;
      let size = 24 + phase * 150;
      if (!this.reduced) size *= 1 + 0.05 * Math.sin(age / 90); // ripple wobble
      const rot = t.rot + age * 0.0012 + phase * 1.2;
      const a = (1 - phase) * fade * Math.min(1, age / 120);
      const cos = Math.cos(rot) * this.dpr;
      const sin = Math.sin(rot) * this.dpr;
      c.setTransform(cos, sin, -sin, cos, x, y);
      if (!this.reduced) {
        c.lineWidth = 5;
        c.globalAlpha = 0.15 * a;
        c.strokeRect(-size / 2, -size / 2, size, size);
      }
      c.lineWidth = 1.5;
      c.globalAlpha = 0.9 * a;
      c.strokeRect(-size / 2, -size / 2, size, size);
    }
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
  }

  private drawTrail(t: Trail, now: number, life: number, pulse: number): void {
    const c = this.ctx;
    const n = t.count;
    const start = (t.head - n + MAX_POINTS) % MAX_POINTS;
    const color = PALETTE[t.color];
    const passes = this.reduced ? 1 : 2;

    for (let pass = 0; pass < passes; pass++) {
      const glow = !this.reduced && pass === 0;
      c.strokeStyle = color;
      let px = 0;
      let py = 0;
      for (let k = 0; k < n; k++) {
        const i = (start + k) % MAX_POINTS;
        const x = t.xs[i];
        const y = t.ys[i];
        const age = 1 - (now - t.ts[i]) / life;
        if (age > 0) {
          const b = t.bs[i];
          const base = (1.5 + b * 4.5) * (0.3 + 0.7 * age);
          c.lineWidth = glow ? base * 3.4 : base;
          c.globalAlpha = (glow ? 0.16 : 0.9) * (0.3 + 0.7 * b) * age;
          // Quadratic curve through segment midpoints keeps fast swipes smooth.
          const nx = k + 1 < n ? t.xs[(start + k + 1) % MAX_POINTS] : x;
          const ny = k + 1 < n ? t.ys[(start + k + 1) % MAX_POINTS] : y;
          const fx = k === 0 ? x : (px + x) / 2;
          const fy = k === 0 ? y : (py + y) / 2;
          const tx = k + 1 < n ? (x + nx) / 2 : x;
          const ty = k + 1 < n ? (y + ny) / 2 : y;
          c.beginPath();
          c.moveTo(fx, fy);
          c.quadraticCurveTo(x, y, tx, ty);
          c.stroke();
        }
        px = x;
        py = y;
      }
    }

    if (t.active) {
      const last = (t.head - 1 + MAX_POINTS) % MAX_POINTS;
      const size = (44 + t.bs[last] * 44) * (this.reduced ? 1 : pulse);
      c.globalAlpha = 0.95;
      c.drawImage(this.sprites[t.color], t.xs[last] - size / 2, t.ys[last] - size / 2, size, size);
    }
    c.globalAlpha = 1;
  }
}
