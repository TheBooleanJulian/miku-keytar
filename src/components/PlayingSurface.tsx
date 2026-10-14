import { useEffect, useMemo, useRef } from "react";
import type { AudioEngine } from "../audio/engine.ts";
import { buildLayout } from "../audio/pitchmap.ts";
import { Instrument } from "../interaction.ts";
import type { Settings } from "../settings.ts";
import { Renderer } from "../visuals/renderer.ts";

interface Props {
  engine: AudioEngine;
  settings: Settings;
  onReadout: (midi: number, brightness: number) => void;
}

/** Owns the canvas. React only re-renders this on settings changes, never per pointer move. */
export function PlayingSurface({ engine, settings, onReadout }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const instrumentRef = useRef<Instrument | null>(null);
  const onReadoutRef = useRef(onReadout);
  onReadoutRef.current = onReadout;

  const { root, lowOctave, octaves, scale, guides, reduced } = settings;
  const layout = useMemo(() => buildLayout(root, lowOctave, octaves, scale), [root, lowOctave, octaves, scale]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas, () => engine.getLevel());
    const instrument = new Instrument(canvas, engine, renderer, (m, b) => onReadoutRef.current(m, b));
    rendererRef.current = renderer;
    instrumentRef.current = instrument;
    renderer.start();
    instrument.attach();
    return () => {
      instrument.dispose();
      renderer.dispose();
      rendererRef.current = null;
      instrumentRef.current = null;
    };
  }, [engine]);

  useEffect(() => {
    instrumentRef.current?.setLayout(layout);
    rendererRef.current?.setLayout(layout, guides);
  }, [layout, guides]);

  useEffect(() => {
    rendererRef.current?.setReduced(reduced);
  }, [reduced]);

  return <canvas ref={canvasRef} className="surface" aria-label="Playing surface: left to right is pitch, bottom to top is brightness" />;
}
