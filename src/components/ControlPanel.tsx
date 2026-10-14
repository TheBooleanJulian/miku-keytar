import type { RefObject } from "react";
import { NOTE_NAMES, SCALES, type ScaleId } from "../audio/pitchmap.ts";
import { PRESETS, type PresetId } from "../audio/presets.ts";
import type { Settings } from "../settings.ts";

interface Props {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onStopAll: () => void;
  onClose: () => void;
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

export function ControlPanel({ settings: s, update, onStopAll, onClose, readoutRef, fullscreen }: Props) {
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

      <div className="field">
        <span>Sound</span>
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
