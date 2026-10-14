import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type EngineState } from "./audio/engine.ts";
import { midiToName } from "./audio/pitchmap.ts";
import { ControlPanel } from "./components/ControlPanel.tsx";
import { PlayingSurface } from "./components/PlayingSurface.tsx";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";

type FsDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

function useFullscreen() {
  const doc = document as FsDocument;
  const supported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [doc]);
  const toggle = useCallback(() => {
    const el = document.documentElement as FsElement;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
      void Promise.resolve(req?.()).catch(() => {});
    }
  }, [doc]);
  return { supported, active, toggle };
}

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [audio, setAudio] = useState<EngineState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const readoutRef = useRef<HTMLOutputElement>(null);
  const fullscreen = useFullscreen();

  useEffect(() => {
    const off = engine.onState(setAudio);
    return () => {
      off();
      engine.dispose();
    };
  }, [engine]);

  useEffect(() => {
    engine.configure(settings);
    saveSettings(settings);
  }, [engine, settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Called at most once per frame by the pointer controller; writes straight to the DOM, no React render.
  const onReadout = useCallback(
    (midi: number, brightness: number) => {
      const el = readoutRef.current;
      if (!el) return;
      el.textContent = `${midiToName(midi)} · brightness ${Math.round(brightness * 100)}% · ${Math.round(engine.cutoffFor(brightness))} Hz`;
    },
    [engine],
  );

  const startAudio = useCallback(async () => {
    setError(null);
    try {
      await engine.init();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio could not be started.");
    }
  }, [engine]);

  const running = audio === "running";

  return (
    <div className="app">
      <PlayingSurface engine={engine} settings={settings} onReadout={onReadout} />

      {!running && (
        <div className="overlay">
          <h1>Miku Keytar</h1>
          <p>Slide left–right for pitch, up–down for brightness. Use several fingers for chords.</p>
          <button type="button" className="btn primary big" onClick={startAudio}>
            {audio === "suspended" ? "Resume Audio" : "Start Audio"}
          </button>
          {audio === "suspended" && <p className="note">Audio was paused by the browser or system.</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="topbar">
        <span className="brand mono">MIKU KEYTAR</span>
        <div className="actions">
          <button
            type="button"
            className={`btn ${settings.muted ? "warn" : ""}`}
            aria-pressed={settings.muted}
            onClick={() => update({ muted: !settings.muted })}
          >
            {settings.muted ? "Muted" : "Mute"}
          </button>
          <button type="button" className="btn danger" onClick={() => engine.stopAll()}>
            Stop all
          </button>
          <button type="button" className="btn" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            Controls
          </button>
        </div>
      </div>

      {panelOpen && (
        <ControlPanel
          settings={settings}
          update={update}
          onStopAll={() => engine.stopAll()}
          onClose={() => setPanelOpen(false)}
          readoutRef={readoutRef}
          fullscreen={fullscreen}
        />
      )}
    </div>
  );
}
