import { useEffect, useReducer, useState, type ReactNode } from "react";
import type { AudioEngine } from "../audio/engine.ts";
import { midiToName } from "../audio/pitchmap.ts";
import type { ReferencePlayer } from "../audio/reference.ts";
import {
  FORMANT_COUNT,
  TWEAK_LIMITS,
  VOWELS,
  VOWEL_ORDER,
  formantScale,
  formantsInto,
  identityTweaks,
  makeFormants,
  vowelPosition,
  type FormantTweak,
  type VowelId,
} from "../audio/vocal/formants.ts";
import {
  BUILTIN_VOCAL,
  BUILTIN_VOCAL_IDS,
  VOCAL_LIMITS,
  type VocalAxis,
  type VocalParams,
} from "../audio/vocal/params.ts";
import type { Settings } from "../settings.ts";
import { MAX_NAME_LENGTH, USER_PREFIX, cleanName, resolvePreset, type UserPresets } from "../vocalStore.ts";
import { SpectrumView } from "./SpectrumView.tsx";

const AUDITION_ID = 2_000_000;

interface Props {
  engine: AudioEngine;
  reference: ReferencePlayer;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  users: UserPresets;
  onSaveUser: (name: string) => boolean;
  onDeleteUser: (name: string) => void;
  yRef: { current: number };
  onClose: () => void;
}

type NumericKey = Exclude<keyof VocalParams, "tweaks" | "vowelTweaks">;

function Slider({
  label,
  value,
  min,
  max,
  step,
  format = (v) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>
        {label}: <em>{format(value)}</em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
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

export function TunerPanel({ engine, reference, settings: s, update, users, onSaveUser, onDeleteUser, yRef, onClose }: Props) {
  const v = s.vocal;
  const [saveName, setSaveName] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  // which vowel the formant sliders edit: every vowel, or one (their adjustments blend into neighbouring vowels)
  const [scope, setScope] = useState<"all" | VowelId>("all");
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => reference.onChange(rerender), [reference]);

  // An edit always means "play the edited sound", so it flips A/B to the edited slot.
  const edit = (patch: Partial<VocalParams>) => update({ vocal: { ...v, ...patch }, vocalCompare: "edited" });
  const num = (key: NumericKey, label: string, step: number, format?: (n: number) => string) => (
    <Slider
      label={label}
      value={v[key]}
      min={VOCAL_LIMITS[key][0]}
      max={VOCAL_LIMITS[key][1]}
      step={step}
      format={format}
      onChange={(n) => edit({ [key]: n } as Partial<VocalParams>)}
    />
  );
  const scoped = (): FormantTweak[] => (scope === "all" ? v.tweaks : v.vowelTweaks[scope]);
  const editTweak = (i: number, patch: Partial<FormantTweak>) => {
    const next = scoped().map((t, k) => (k === i ? { ...t, ...patch } : t));
    edit(scope === "all" ? { tweaks: next } : { vowelTweaks: { ...v.vowelTweaks, [scope]: next } });
  };

  const slot = s.instrument === "lead" ? "lead" : s.vocalCompare;
  const setSlot = (next: "lead" | "default" | "edited") =>
    update(next === "lead" ? { instrument: "lead" } : { instrument: "vocal", vocalCompare: next });

  const pickPreset = (id: string) => update({ vocalPreset: id, vocal: resolvePreset(id, users), vocalCompare: "edited" });

  // Effective formant values at the panel's vowel position, shown beside the sliders.
  const fm = makeFormants();
  formantsInto(fm, v.vowelPos, v.tweaks, v.vowelTweaks, formantScale(440 * Math.pow(2, (s.auditionNote - 69) / 12), v.tracking));

  const auditionDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone
    }
    engine.noteOn(AUDITION_ID, s.auditionNote, s.vocalAxis === "morph" ? v.vowelPos : v.brightness);
  };
  const auditionUp = () => engine.noteOff(AUDITION_ID);

  const userNames = Object.keys(users);
  const currentIsUser = s.vocalPreset.startsWith(USER_PREFIX);

  return (
    <section className="panel tuner" aria-label="Vocal timbre tuner">
      <header className="panel-head">
        <span className="mono">VOCAL TUNER</span>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="field">
        <span>Compare (loudness-matched)</span>
        <div className="seg" role="radiogroup" aria-label="A/B comparison">
          {(
            [
              ["lead", "A · Keytar lead"],
              ["default", "B · Vocal preset"],
              ["edited", "C · Vocal edited"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={slot === id}
              className={slot === id ? "on" : ""}
              onClick={() => setSlot(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {slot === "lead" && <p className="hint">Playing the original lead. Pick B or C to hear the vocal engine.</p>}
      </div>

      <SpectrumView
        engine={engine}
        reference={reference}
        vowelPos={v.vowelPos}
        tweaks={v.tweaks}
        vowelTweaks={v.vowelTweaks}
        tracking={v.tracking}
        hold={v.vowelHold}
        axis={s.vocalAxis}
        yRef={yRef}
        note={s.auditionNote}
      />
      <p className="hint legend">
        <b className="c-teal">teal</b> = measured output · <b className="c-gold">gold dashed</b> = configured formant centres
        (targets, not measurements) · <b className="c-pink">magenta</b> = reference recording
      </p>

      <div className="field">
        <span>Preset</span>
        <select value={s.vocalPreset} onChange={(e) => pickPreset(e.target.value)}>
          <optgroup label="Built-in">
            {BUILTIN_VOCAL_IDS.map((id) => (
              <option key={id} value={id}>
                {BUILTIN_VOCAL[id].label}
              </option>
            ))}
          </optgroup>
          {userNames.length > 0 && (
            <optgroup label="My presets">
              {userNames.map((n) => (
                <option key={n} value={USER_PREFIX + n}>
                  {n}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {s.vocalPreset in BUILTIN_VOCAL && (
          <p className="hint">{BUILTIN_VOCAL[s.vocalPreset as keyof typeof BUILTIN_VOCAL].blurb}</p>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => pickPreset(s.vocalPreset)}>
            Reset edits
          </button>
          {currentIsUser && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                onDeleteUser(s.vocalPreset.slice(USER_PREFIX.length));
                pickPreset("bright");
              }}
            >
              Delete preset
            </button>
          )}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (onSaveUser(saveName)) setSaveName("");
          }}
        >
          <input
            className="text"
            type="text"
            placeholder="Save edits as…"
            maxLength={MAX_NAME_LENGTH}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            aria-label="Name for the new preset"
          />
          <button type="submit" className="btn" disabled={!cleanName(saveName)}>
            Save
          </button>
        </form>
      </div>

      <Group title="VOWEL & PITCH" open>
        <div className="field">
          <span>Vowel</span>
          <div className="vowels" role="group" aria-label="Vowel">
            {VOWEL_ORDER.map((id) => {
              const on = Math.abs(v.vowelPos - vowelPosition(id)) < 0.01;
              return (
                <button
                  key={id}
                  type="button"
                  className={`btn vowel${on ? " on" : ""}`}
                  aria-pressed={on}
                  title={`${VOWELS[id].kana} ${VOWELS[id].ipa}`}
                  onClick={() => edit({ vowelPos: vowelPosition(id) })}
                >
                  {VOWELS[id].kana}
                </button>
              );
            })}
          </div>
        </div>
        {num("vowelPos", "Vowel (あ → い → う → え → お)", 0.01)}
        {num("vowelHold", "Vowel hold (higher = the slide rests on each vowel)", 0.01)}
        <div className="field">
          <span>Vertical axis while playing</span>
          <div className="seg" role="radiogroup" aria-label="Vertical axis">
            {(
              [
                ["morph", "Vowel morph"],
                ["fixed", "Fixed vowel + brightness"],
              ] as [VocalAxis, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={s.vocalAxis === id}
                className={s.vocalAxis === id ? "on" : ""}
                onClick={() => update({ vocalAxis: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Slider
          label="Audition note"
          value={s.auditionNote}
          min={36}
          max={96}
          step={1}
          format={(n) => midiToName(n)}
          onChange={(n) => update({ auditionNote: n })}
        />
        <button
          type="button"
          className="btn tap"
          onPointerDown={auditionDown}
          onPointerUp={auditionUp}
          onPointerCancel={auditionUp}
          onLostPointerCapture={auditionUp}
          onContextMenu={(e) => e.preventDefault()}
          disabled={engine.state !== "running"}
        >
          Hold to audition {midiToName(s.auditionNote)}
        </button>
        {num("tracking", "Formant pitch-tracking (0 = independent)", 0.01)}
      </Group>

      <Group title="EXCITATION" open>
        {num("pulse", "Pulse level", 0.01)}
        {num("pulseWidth", "Pulse width (0.5 = square)", 0.01)}
        {num("saw", "Sawtooth level", 0.01)}
        {num("sine", "Sine level", 0.01)}
        {num("brightness", "Brightness", 0.01)}
        {num("breath", "Breathiness", 0.01)}
      </Group>

      <Group title="EXPRESSION">
        {num("vibratoRate", "Vibrato rate", 0.1, (n) => `${n.toFixed(1)} Hz`)}
        {num("vibratoDepth", "Vibrato depth", 1, (n) => `${n.toFixed(0)} cents`)}
        {num("vibratoDelay", "Vibrato onset delay", 0.05, (n) => `${n.toFixed(2)} s`)}
        {num("jitter", "Pitch drift", 0.5, (n) => `${n.toFixed(1)} cents`)}
        {num("attack", "Attack", 0.002, (n) => `${(n * 1000).toFixed(0)} ms`)}
        {num("sustain", "Sustain level", 0.01)}
        {num("release", "Release", 0.01, (n) => `${(n * 1000).toFixed(0)} ms`)}
      </Group>

      <Group title="EFFECTS">
        {num("chorus", "Chorus", 0.01)}
        {num("reverb", "Reverb", 0.01)}
        <p className="hint">Both are bypassed by the “Effects” switch in Settings.</p>
      </Group>

      <Group title="FORMANTS (F1–F5)">
        <div className="field">
          <span>Edit formants of</span>
          <div className="seg" role="radiogroup" aria-label="Which vowel the formant sliders edit">
            {([["all", "All"], ...VOWEL_ORDER.map((id) => [id, VOWELS[id].kana])] as ["all" | VowelId, string][]).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={scope === id} className={scope === id ? "on" : ""} onClick={() => setScope(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">
          Values are multipliers. “All” applies to every vowel; choosing a vowel adjusts only that vowel and fades out into
          its neighbours, so tuning あ cannot disturb い or う. The Hz shown is where each resonance currently sits for
          the vowel position above.
        </p>
        {Array.from({ length: FORMANT_COUNT }, (_, i) => (
          <div key={i} className="formant-row">
            <b className="mono">
              F{i + 1} · {Math.round(fm[i].freq)} Hz · BW {Math.round(fm[i].bw)} Hz
            </b>
            <Slider
              label="Frequency"
              value={scoped()[i].freq}
              min={TWEAK_LIMITS.freq[0]}
              max={TWEAK_LIMITS.freq[1]}
              step={0.01}
              format={(n) => `×${n.toFixed(2)}`}
              onChange={(n) => editTweak(i, { freq: n })}
            />
            <Slider
              label="Bandwidth"
              value={scoped()[i].bw}
              min={TWEAK_LIMITS.bw[0]}
              max={TWEAK_LIMITS.bw[1]}
              step={0.01}
              format={(n) => `×${n.toFixed(2)}`}
              onChange={(n) => editTweak(i, { bw: n })}
            />
            <Slider
              label="Gain"
              value={scoped()[i].gain}
              min={TWEAK_LIMITS.gain[0]}
              max={TWEAK_LIMITS.gain[1]}
              step={0.01}
              format={(n) => `×${n.toFixed(2)}`}
              onChange={(n) => editTweak(i, { gain: n })}
            />
          </div>
        ))}
        <button type="button" className="btn" onClick={() => edit(scope === "all" ? { tweaks: identityTweaks() } : { vowelTweaks: { ...v.vowelTweaks, [scope]: identityTweaks() } })}>
          Reset {scope === "all" ? "all-vowel" : VOWELS[scope].kana} formants to neutral
        </button>
      </Group>

      <Group title="REFERENCE AUDIO (LOCAL)">
        <p className="hint">
          Choose a recording you have the right to use. It is decoded in this browser and never uploaded. Recordings
          usually contain accompaniment, reverb and compression, so not every peak is a vocal formant. Use it to
          compare by ear and by eye, not to extract exact values.
        </p>
        <input
          type="file"
          accept="audio/*"
          aria-label="Reference audio file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setRefError(null);
            try {
              await reference.load(file);
            } catch (err) {
              setRefError(err instanceof Error ? err.message : "Could not load that file.");
            }
          }}
        />
        {refError && (
          <p className="error" role="alert">
            {refError}
          </p>
        )}
        {reference.state !== "empty" && (
          <>
            <p className="hint">
              {reference.name} · {reference.duration.toFixed(1)} s · {reference.state}
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={() => reference.play()} disabled={reference.state === "playing"}>
                Play
              </button>
              <button type="button" className="btn" onClick={() => reference.pause()} disabled={reference.state !== "playing"}>
                Pause
              </button>
              <button type="button" className="btn" onClick={() => reference.stop()}>
                Stop
              </button>
            </div>
          </>
        )}
      </Group>
    </section>
  );
}
