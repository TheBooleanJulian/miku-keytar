import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diatonicChords } from "./audio/chords.ts";
import { AudioEngine, type EngineState } from "./audio/engine.ts";
import { midiToName } from "./audio/pitchmap.ts";
import { ChordBar } from "./components/ChordBar.tsx";
import { ControlPanel } from "./components/ControlPanel.tsx";
import { Harmony, type HarmonyState } from "./harmony.ts";
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

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Speaker with sound waves (on) or a cross (off). */
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg {...iconProps}>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      {on ? <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" /> : <path d="M17 9l5 6M22 9l-5 6" />}
    </svg>
  );
}

/** Metronome; the arm swings while the rhythm is running (see .live in styles.css). */
function MetronomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 21L10.5 3h3L15 21z" />
      <path d="M6 21h12" />
      <path className="arm" d="M12 17L15.5 7" />
    </svg>
  );
}

/** Ring with eight teeth. */
function GearIcon() {
  const teeth = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (r: number) => `${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`;
    return `M${p(7.5)}L${p(10.5)}`;
  }).join("");
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2.2" />
      <path d={teeth} />
    </svg>
  );
}

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const sync = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);
  return vp;
}

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;
  const harmonyRef = useRef<Harmony | null>(null);
  if (!harmonyRef.current) harmonyRef.current = new Harmony(engine);
  const harmony = harmonyRef.current;
  const [chordUi, setChordUi] = useState<HarmonyState>({ mask: 0, rhythmRunning: false });

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [audio, setAudio] = useState<EngineState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const readoutRef = useRef<HTMLOutputElement>(null);
  const fullscreen = useFullscreen();

  useEffect(() => {
    const off = engine.onState(setAudio);
    const offChords = harmony.onChange(setChordUi);
    return () => {
      off();
      offChords();
      harmony.dispose();
      engine.dispose();
    };
  }, [engine, harmony]);

  const { keyRoot, keyMode, sevenths, chordMode, pattern, bpm, layers } = settings;
  useEffect(() => {
    harmony.configure({ keyRoot, keyMode, sevenths, chordMode, pattern, bpm, layers });
  }, [harmony, keyRoot, keyMode, sevenths, chordMode, pattern, bpm, layers]);
  const chords = useMemo(() => diatonicChords(keyRoot, keyMode, sevenths), [keyRoot, keyMode, sevenths]);

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

  // If the screen's shape disagrees with the chosen orientation, lay the app out at the swapped
  // size and rotate it 90° clockwise (works on iOS, which can't lock orientation).
  const vp = useViewport();
  const screenLandscape = vp.w >= vp.h;
  const rotated = (settings.orientation === "landscape") !== screenLandscape;
  const rotatedStyle = rotated
    ? { width: vp.h, height: vp.w, transform: `translateX(${vp.w}px) rotate(90deg)` }
    : undefined;

  return (
    <div
      className={`app ${settings.orientation === "landscape" ? "land" : "port"}${rotated ? " rotated" : ""}`}
      style={rotatedStyle}
    >
      <PlayingSurface engine={engine} settings={settings} onReadout={onReadout} rotated={rotated} chords={harmony} />

      <ChordBar
        chords={chords}
        mask={chordUi.mask}
        onPress={(degree, pointerId) => harmony.press(pointerId, degree)}
        onRelease={(pointerId) => harmony.release(pointerId)}
      />

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
        <div className="brand mono">
          <span>MIKU KEYTAR</span>
          <small>Built by TheBooleanJulian</small>
        </div>
        <div className="actions">
          {chordMode === "rhythm" && (
            <button
              type="button"
              className={`btn icon ${chordUi.rhythmRunning ? "live" : ""}`}
              aria-pressed={chordUi.rhythmRunning}
              aria-label={chordUi.rhythmRunning ? "Stop rhythm" : "Start rhythm"}
              title={chordUi.rhythmRunning ? "Stop rhythm" : "Start rhythm"}
              disabled={!running}
              onClick={() => harmony.toggleRhythm()}
            >
              <MetronomeIcon />
            </button>
          )}
          <button
            type="button"
            className={`btn icon ${settings.muted ? "warn" : ""}`}
            aria-pressed={settings.muted}
            aria-label={settings.muted ? "Sound off: tap to unmute" : "Sound on: tap to mute"}
            title={settings.muted ? "Sound off" : "Sound on"}
            onClick={() => update({ muted: !settings.muted })}
          >
            <SoundIcon on={!settings.muted} />
          </button>
          <button
            type="button"
            className="btn icon"
            aria-expanded={panelOpen}
            aria-label="Settings"
            title="Settings"
            onClick={() => setPanelOpen((o) => !o)}
          >
            <GearIcon />
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
