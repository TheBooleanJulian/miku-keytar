import { useRef, type ReactNode, type RefObject } from "react";
import { PATTERNS } from "../audio/patterns.ts";
import { TapTempo } from "../audio/taptempo.ts";
import { NOTE_NAMES, SCALES, type ScaleId } from "../audio/pitchmap.ts";
import { PRESETS, type PresetId } from "../audio/presets.ts";
import type { Layer } from "../audio/rhythm.ts";
import type { Settings } from "../settings.ts";

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onStopAll: () => void;
  onClose: () => void;
  onOpenTuner: () => void;
  readoutRef: RefObject<HTMLOutputElement | null>;
  fullscreen: { supported: boolean; active: boolean; toggle: () => void };
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <i aria-hidden="true" />
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "on" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Group({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary className="mono">{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

const LAYER_LABELS: [Layer, string][] = [
  ["drums", "Drums"],
  ["bass", "Bass"],
  ["pad", "Pad"],
  ["arp", "Arp pluck"],
];

export function ControlPanel({ settings: s, update, onStopAll, onClose, onOpenTuner, readoutRef, fullscreen }: Props) {
  const tapTempo = useRef(new TapTempo());
  return (
    <section className="panel" aria-label="Controls">
      <header className="panel-head">
        <span className="mono">CONTROLS</span>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      <output ref={readoutRef} className="readout mono" aria-live="off">
        — touch the surface —
      </output>

      <label className="field">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.volume}
          onChange={(e) => update({ volume: Number(e.target.value) })}
        />
      </label>

      <Group title="INSTRUMENT" open>
        <Segmented
          label="Instrument"
          value={s.instrument}
          options={[
            { value: "lead", label: "Keytar lead" },
            { value: "vocal", label: "Vocal (formant)" },
          ]}
          onChange={(instrument) => update({ instrument })}
        />
        {s.instrument === "vocal" && (
          <Segmented
            label="Vertical axis"
            value={s.vocalAxis}
            options={[
              { value: "morph", label: "Vowel morph" },
              { value: "fixed", label: "Fixed vowel + brightness" },
            ]}
            onChange={(vocalAxis) => update({ vocalAxis })}
          />
        )}
        <button type="button" className="btn" onClick={onOpenTuner}>
          Open vocal tuner
        </button>
        <p className="hint">
          {s.instrument === "vocal"
            ? "Left–right is pitch. Up–down morphs the vowel (or brightens a fixed vowel)."
            : "The vocal engine is a synthetic, vowel-only voice. Switch to it to play sustained vowels."}
        </p>
      </Group>

      <Group title="SCALE & SOUND" open>
        <div className="grid">
          <label className="field">
            <span>Root note</span>
            <select value={s.root} onChange={(e) => update({ root: Number(e.target.value) })}>
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Scale</span>
            <select value={s.scale} onChange={(e) => update({ scale: e.target.value as ScaleId })}>
              {Object.entries(SCALES).map(([id, sc]) => (
                <option key={id} value={id}>
                  {sc.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Lowest octave</span>
            <select value={s.lowOctave} onChange={(e) => update({ lowOctave: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Octave range</span>
            <select value={s.octaves} onChange={(e) => update({ octaves: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Segmented
          label="Orientation"
          value={s.orientation}
          options={[
            { value: "landscape", label: "Landscape" },
            { value: "portrait", label: "Portrait" },
          ]}
          onChange={(orientation) => update({ orientation })}
        />

        <div className="field">
          <span>Lead sound</span>
          <div className="seg" role="radiogroup" aria-label="Sound preset">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={s.preset === id}
                className={s.preset === id ? "on" : ""}
                onClick={() => update({ preset: id })}
              >
                {PRESETS[id].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid">
          <Toggle label="Pitch glide" checked={s.glide} onChange={(glide) => update({ glide })} />
          <Toggle label="Effects (echo)" checked={s.effects} onChange={(effects) => update({ effects })} />
          <Toggle label="Vibrato" checked={s.modulation} onChange={(modulation) => update({ modulation })} />
          <Toggle label="Note guides" checked={s.guides} onChange={(guides) => update({ guides })} />
          <Toggle label="Reduced visuals" checked={s.reduced} onChange={(reduced) => update({ reduced })} />
        </div>
      </Group>

      <Group title="CHORDS" open>
        <div className="grid">
          <label className="field">
            <span>Key</span>
            <select value={s.keyRoot} onChange={(e) => update({ keyRoot: Number(e.target.value) })}>
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label="Mode"
            value={s.keyMode}
            options={[
              { value: "major", label: "Major" },
              { value: "minor", label: "Minor" },
            ]}
            onChange={(keyMode) => update({ keyMode })}
          />
        </div>
        <Segmented
          label="Play chords"
          value={s.chordMode}
          options={[
            { value: "rubato", label: "Rubato" },
            { value: "rhythm", label: "With rhythm" },
          ]}
          onChange={(chordMode) => update({ chordMode })}
        />
        <p className="hint">
          {s.chordMode === "rubato"
            ? "Chords sound while the button is held."
            : "Tap a chord to pick it and start the groove; it keeps playing until you change it."}
        </p>
        <div className="grid">
          <Toggle label="7th chords" checked={s.sevenths} onChange={(sevenths) => update({ sevenths })} />
          <Toggle label="Snap melody to chord" checked={s.chordSnap} onChange={(chordSnap) => update({ chordSnap })} />
        </div>
        <label className="field">
          <span>Snap after holding still: {s.snapDelay} ms</span>
          <input
            type="range"
            min={150}
            max={2000}
            step={50}
            value={s.snapDelay}
            disabled={!s.chordSnap}
            onChange={(e) => update({ snapDelay: Number(e.target.value) })}
          />
        </label>
        <button type="button" className="btn" onClick={() => update({ root: s.keyRoot, scale: s.keyMode })}>
          Set melody scale to {NOTE_NAMES[s.keyRoot]} {s.keyMode}
        </button>
      </Group>

      <Group title="RHYTHM">
        <label className="field">
          <span>Pattern</span>
          <select
            value={s.pattern}
            onChange={(e) => {
              const pattern = Number(e.target.value);
              update({ pattern, bpm: PATTERNS[pattern].bpm });
            }}
          >
            {PATTERNS.map((p, i) => (
              <option key={p.name} value={i}>
                {i + 1}. {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tempo: {s.bpm} BPM</span>
          <input
            type="range"
            min={50}
            max={200}
            step={1}
            value={s.bpm}
            onChange={(e) => update({ bpm: Number(e.target.value) })}
          />
        </label>
        <button
          type="button"
          className="btn tap"
          onPointerDown={(e) => {
            e.preventDefault();
            const bpm = tapTempo.current.tap(e.timeStamp);
            if (bpm !== null) update({ bpm });
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
              e.preventDefault();
              const bpm = tapTempo.current.tap(e.timeStamp);
              if (bpm !== null) update({ bpm });
            }
          }}
        >
          Tap tempo
        </button>
        <p className="hint">Tap at least twice in time. A pause of 2 seconds starts over.</p>
        <label className="field">
          <span>Rhythm volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={s.rhythmVolume}
            onChange={(e) => update({ rhythmVolume: Number(e.target.value) })}
          />
        </label>
        <div className="grid">
          {LAYER_LABELS.map(([layer, label]) => (
            <Toggle
              key={layer}
              label={label}
              checked={s.layers[layer]}
              onChange={(v) => update({ layers: { ...s.layers, [layer]: v } })}
            />
          ))}
        </div>
        {s.chordMode === "rubato" && <p className="hint">Switch “Play chords” to “With rhythm” to use the rhythm section.</p>}
      </Group>

      <div className="row">
        <button type="button" className="btn danger" onClick={onStopAll}>
          Stop all
        </button>
        {fullscreen.supported && (
          <button type="button" className="btn" onClick={fullscreen.toggle}>
            {fullscreen.active ? "Exit full screen" : "Full screen"}
          </button>
        )}
      </div>
    </section>
  );
}
