import { useEffect, useRef } from "react";
import type { AudioEngine } from "../audio/engine.ts";
import type { ReferencePlayer } from "../audio/reference.ts";
import {
  FORMANT_COUNT,
  formantScale,
  formantsInto,
  makeFormants,
  type FormantTweak,
  type VowelTweaks,
} from "../audio/vocal/formants.ts";
import { effectiveVowelPos, type VocalAxis } from "../audio/vocal/params.ts";

const F_MIN = 60;
const F_MAX = 10000;
const LOG_SPAN = Math.log(F_MAX / F_MIN);
const FRAME_MS = 33; // ~30 fps is plenty for a tuning display

interface Props {
  engine: AudioEngine;
  reference: ReferencePlayer;
  vowelPos: number;
  tweaks: readonly FormantTweak[];
  vowelTweaks: VowelTweaks;
  tracking: number;
  hold: number;
  axis: VocalAxis;
  /** Latest vertical touch position 0..1, written by the pointer handler (read here, never rendered). */
  yRef: { current: number };
  /** MIDI note used to apply pitch tracking to the markers. */
  note: number;
}

/**
 * Live spectrum. Teal = measured output of the synth. Gold dashed lines = the formant centres the engine is
 * configured with (targets, not measurements). Magenta = the optional reference recording.
 */
export function SpectrumView({ engine, reference, vowelPos, tweaks, vowelTweaks, tracking, hold, axis, yRef, note }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Props change on every edit; the loop reads them through a ref so it never restarts.
  const live = useRef({ vowelPos, tweaks, vowelTweaks, tracking, hold, axis, note });
  live.current = { vowelPos, tweaks, vowelTweaks, tracking, hold, axis, note };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const fm = makeFormants();
    let out: Float32Array<ArrayBuffer> | null = null;
    let ref: Float32Array<ArrayBuffer> | null = null;
    let raf = 0;
    let last = 0;
    let w = 1;
    let h = 1;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, canvas.clientWidth);
      h = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const xOf = (hz: number) => (Math.log(Math.max(hz, F_MIN) / F_MIN) / LOG_SPAN) * w;

    const drawCurve = (data: Float32Array, info: { sampleRate: number; minDb: number; maxDb: number }, stroke: string, fill: string | null) => {
      const nyq = info.sampleRate / 2;
      const bins = data.length;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 2) {
        const f0 = F_MIN * Math.exp((px / w) * LOG_SPAN);
        const f1 = F_MIN * Math.exp(((px + 2) / w) * LOG_SPAN);
        const b0 = Math.min(bins - 1, Math.floor((f0 / nyq) * bins));
        const b1 = Math.min(bins - 1, Math.max(b0, Math.floor((f1 / nyq) * bins)));
        let m = -Infinity;
        for (let b = b0; b <= b1; b++) if (data[b] > m) m = data[b];
        const t = (m - info.minDb) / (info.maxDb - info.minDb);
        const y = h - 14 - Math.min(1, Math.max(0, t)) * (h - 22);
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (fill) {
        ctx.lineTo(w, h - 14);
        ctx.lineTo(0, h - 14);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS || document.hidden) return;
      last = now;
      const info = engine.spectrumInfo();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#050508";
      ctx.fillRect(0, 0, w, h);

      // grid + axis labels
      ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(160,235,230,0.4)";
      ctx.strokeStyle = "rgba(0,212,200,0.12)";
      ctx.lineWidth = 1;
      for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = Math.round(xOf(hz)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h - 14);
        ctx.stroke();
        ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, Math.min(Math.max(x, 12), w - 12), h - 3);
      }

      if (!info) {
        ctx.fillStyle = "rgba(160,235,230,0.6)";
        ctx.fillText("Start audio to see the spectrum", w / 2, h / 2);
        return;
      }
      if (!out || out.length !== info.bins) {
        out = new Float32Array(info.bins);
        ref = new Float32Array(info.bins);
      }
      if (engine.readSpectrum(out)) drawCurve(out, info, "#00D4C8", "rgba(0,212,200,0.12)");
      if (ref && reference.readSpectrum(ref)) drawCurve(ref, info, "#ff2bd6", null);

      // configured formant centres (targets, not measurements)
      const s = live.current;
      const pos = engine.activeVoiceCount > 0 ? effectiveVowelPos(s.vowelPos, yRef.current, s.axis, s.hold) : s.vowelPos;
      formantsInto(fm, pos, s.tweaks, s.vowelTweaks, formantScale(440 * Math.pow(2, (s.note - 69) / 12), s.tracking));
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#F5C842";
      ctx.fillStyle = "#F5C842";
      ctx.textAlign = "left";
      for (let i = 0; i < FORMANT_COUNT; i++) {
        const x = xOf(fm[i].freq);
        ctx.beginPath();
        ctx.moveTo(x, 12);
        ctx.lineTo(x, h - 14);
        ctx.stroke();
        ctx.fillText(`F${i + 1}`, x + 3, 10);
      }
      ctx.setLineDash([]);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [engine, reference, yRef]);

  return <canvas ref={canvasRef} className="spectrum" aria-label="Live spectrum of the synthesiser output" />;
}
