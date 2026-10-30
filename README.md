# Miku Keytar

A playable two-axis web synthesizer inspired by the Ano Gakki instrument from *Innocence*.
Slide a finger **left/right for pitch** and **up/down for brightness**; use several fingers for chords.
Static site: no backend, accounts, database, samples or paid services. All sound is synthesised in the browser.

Stack: React + TypeScript + Vite, Web Audio API, Canvas 2D. Runtime dependencies: `react`, `react-dom` only.

## Install, develop, build

Requires Node 20.19+ (developed on Node 22).

```bash
npm install
npm run dev        # http://localhost:5173 (use your LAN IP from a phone: npm run dev -- --host)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
npm run typecheck
npm test           # pitch-mapping + audio-voice lifecycle tests (Node's built-in runner, no extra deps)
```

> **Google Drive note:** don't run `npm install` inside a Google Drive folder (it corrupts `node_modules`).
> Work from a copy outside Drive and copy source files back, excluding `node_modules` and `dist`.

## Deploy

`npm run build` produces a fully static `dist/` folder (`base: "./"`, so it works at a domain root or a sub-path).
Upload `dist/` to any static host: Zeabur static service, GitHub Pages, Netlify, Cloudflare Pages, S3.
It must be served over **HTTPS** (or `localhost`) for the service worker and full-screen to work.

Offline: the production build registers `sw.js`, which precaches the app shell on first load and falls back to
cache when the network is unavailable. Load the page once online, then it opens offline.

## How it works

### Coordinate → sound

| Axis | Mapping |
|---|---|
| **X (pitch)** | Position 0..1 spans `octaves` (default 2) starting at root note in `lowest octave` (default C3). The raw position is snapped to the **nearest note of the selected scale** (chromatic = every semitone). Frequency = `440 · 2^((midi − 69)/12)`. With *Pitch glide* on, frequency changes use a ~70 ms time constant (portamento); otherwise ~5 ms, which is effectively instant but click-free. |
| **Y (brightness)** | Position 0..1 (4 % dead zone at each edge) drives a low-pass filter cutoff on a **logarithmic** curve: `cutoff = min · (max/min)^y`. Each preset has its own range, e.g. Pure 220 Hz → 7 kHz. The Controls panel shows the live value in Hz. |

Orientation does not change the mapping: X is always pitch, Y is always brightness.

### Synthesis (`src/audio/`)

Each touch is an independent **voice**:

```
sine ─┐
triangle ─┼─ mix gains ─ low-pass filter (Y axis) ─ envelope gain ─┐
sawtooth ─┘                                                         ├─ voice bus ─ dry ───────┐
                                                                    │              └ echo ──┤
                                                                    └──────── compressor ─ master volume ─ mute ─ out
```

- **Envelope:** attack/release use `setTargetAtTime` exponential approaches, never hard jumps, so starting, moving
  and releasing a note produces no clicks. Oscillators are stopped only after the release has decayed to silence,
  then disconnected (`onended`), so no voices are orphaned.
- **Presets** (all real-time): *Square lead* (default: square + sine, 10 ms attack, 160 ms release, light chorus and
  short reverb), *Pure* (sine+triangle, soft), *Digital* (saw-heavy, resonant, bright), *Ethereal* (slow
  attack, long release, more echo). Switching presets updates notes that are already sounding.
- **Effects** (one toggle): feedback echo, a light two-tap chorus, and a short convolution reverb whose impulse
  response is synthesised from decaying noise at startup (no sample files). Each preset sets its own send levels. **Vibrato:** one shared LFO (5.5 Hz, ±14 cents), off by default.
- **Limits:** up to 10 simultaneous voices (oldest is stolen). A compressor prevents clipping when stacking notes.
- **Stop All** fades every voice (including ones already releasing) in ~40 ms. The page being hidden or the window
  losing focus also stops all voices.

### Touch visuals

Every touch spawns a cyan line through the touched point at a random angle. If the touch is held longer than 220 ms
(a rapid tap is shorter), expanding, rotating cyan squares ripple out from the finger until release, then fade.

### Vocal mode (formant synthesis)

An optional, Miku-*inspired* synthetic voice. **It is not a Hatsune Miku voicebank and does not reproduce her voice.**
The aim is a bright, youthful, slightly nasal, electronically clean vowel sound that you can shape by ear.

**Enable it:** Settings → *Instrument* → **Vocal (formant)**. The *Keytar lead* stays the default and is untouched:
its presets, mappings and effects do not change, and notes already sounding keep their instrument when you switch.
A tuner icon then appears in the top bar (also: Settings → *Open vocal tuner*).

#### How formant synthesis works

A voice is a **source** shaped by a **filter**. Here the source is a pulse train (the "vocal folds"), optionally mixed with
sawtooth, sine and a little filtered noise (breath). The filter is the vocal tract: a bank of five resonant band-pass
filters at the **formant** frequencies. Which vowel you hear depends on where those resonances sit (mainly F1 and F2),
*not* on the pitch, so pitch and vowel are separate controls and can be changed independently.

```
pulse (band-limited wave, adjustable width) --+
sawtooth -------------------------------------+-> brightness low-pass --+
sine -----------------------------------------+                        +--> 5 parallel band-pass filters (F1-F5)
looped noise -> high-pass -> breath ---------------------------------------+        |
                                                                                    v
                                              per-voice vibrato + drift -> pitch    envelope -> shared chorus / reverb -> out
```

Every voice has its own oscillators, filters, envelope, vibrato and slow pitch drift, so held notes are independent.
Parameter changes use short exponential smoothing and the pulse is a band-limited `PeriodicWave`, so moving a slider
or a finger does not click or alias. Everything is synthesised in the browser; there are no audio files.

#### Pitch and vowel mapping

- **Horizontal:** pitch, exactly as in the lead (same scales, snapping, glide, chord snapping and multi-touch).
- **Vertical, "Vowel morph" (default):** bottom to top is **あ → い → う → え → お**, the order you recite them in.
  The jumps between neighbours are large (い → う, え → お), so *Vowel hold* makes each vowel a flat zone and the
  crossings quick. Frequencies and bandwidths interpolate geometrically; gains linearly.
- **Vertical, "Fixed vowel + brightness":** pick the vowel from the **Vowel** dropdown in the Controls panel (also the
  あ い う え お buttons in the tuner); the vertical axis is then the brightness over its whole range, exactly like the
  lead's brightness axis, and left–right is pitch.
- Chord buttons use the same voice at a lower level (in morph mode they sing あ).

**Making the vowels read clearly.** Two things matter more than the exact formant numbers:

1. **Each vowel has its own brightness.** The front vowels (い え) carry strong second and third formants and the back
   vowels (う お) almost none, so the sweep changes the *spectral balance*, not just the position of F1. Measured at
   C5, the energy at 2.5-4 kHz is about 25 dB higher on い than on う. This is audible on a phone speaker, which cannot
   reproduce the low F1 differences between う, お and あ.
2. **Vowel hold.** Moving a finger up a continuous slide spends most of its time on in-between blends. *Vowel hold*
   (0 to 1) reshapes each span between two vowels with an S-curve, so the finger rests on the pure vowel across a wide
   zone and crosses quickly between them. The Miku preset uses 0.7; set 0 for the plain linear slide.

High notes are the limit: above about C5 the harmonics are too far apart to sample F1, and all five vowels drift towards あ
(real singers have the same problem and tune F1 to the pitch). `vowels.mjs` in `tools/reference/` measures this.

#### Controls (Vocal Tuner)

| Control | What it does |
|---|---|
| **Compare A/B/C** | A: the original keytar lead. B: the selected vocal preset, untouched. C: your edited vocal. One tap switches while you play. |
| **Preset** | Miku-inspired (ref fit, the default), Bright Vocal, Soft Vocal, Electronic Vocal, plus your saved presets. Selecting one loads it into the editor. |
| **Vowel / Vowel morph** | Panel vowel position. Used as the sung vowel in fixed mode and for the spectrum markers. |
| **Audition note** | The note the *Hold to audition* button sounds, so you can tune without a second hand. |
| **Formant pitch-tracking** | 0 keeps the formants fixed whatever the pitch (the default stays small). Higher values drift them gently up on high notes and down on low ones, as a stylisation. |
| **Pulse level / width** | Level of the pulse wave and its duty cycle. 0.5 is a square (odd harmonics only); narrower pulses are brighter and more nasal. |
| **Sawtooth / Sine level** | Extra harmonics for edge, or body underneath. |
| **Brightness** | Low-pass cutoff on the excitation (1.5 kHz to 12 kHz, logarithmic). |
| **Breathiness** | Noise through the same vocal tract, with the periodic source slightly reduced. |
| **Vibrato rate / depth / onset delay** | Per-voice vibrato (Hz, cents, seconds before it fades in). |
| **Vowel hold** | How strongly the vertical slide rests on each pure vowel (see above). Morph mode only. |
| **Pitch drift** | Very slow, per-voice random-ish wander in cents: a little life without a wobble. |
| **Attack / Sustain / Release** | Envelope (sustain is the held level). Short attacks keep notes articulate. |
| **Chorus / Reverb** | Sends into the shared effects. Bypassed by the Settings *Effects* switch. The vocal has no echo so the timbre stays clear. |
| **F1-F5 Frequency / Bandwidth / Gain** | Per-resonance multipliers. *Edit formants of* chooses **All** vowels or one vowel (あ い う え お): a single-vowel edit applies fully there and fades into its neighbours, so tuning あ cannot disturb い. The header shows the current Hz and bandwidth for the panel vowel. |

All values are bounded and validated; nothing can be set outside a safe range, and saved or imported data is sanitised.

#### Creating and tuning presets

1. Pick the nearest built-in preset, press **Hold to audition** (or play), and adjust one control at a time.
2. Use **A/B/C** to compare against the lead and against the untouched preset. Levels are matched automatically
   (see *Loudness matching*), so the louder one does not win by default.
3. Type a name and **Save**. Presets are stored in this browser only (`localStorage`, key
   `miku-keytar:vocal-presets:v1`), separately from the main settings, up to 20 of 24-character names. They never
   overwrite built-in presets. **Reset edits** returns to the selected preset; **Delete preset** removes a saved one.

Suggested order: vowel and formant gains first (character), then pulse width and brightness (edge), then breathiness,
vibrato and attack (expression), and chorus/reverb last, since effects can hide problems in the core sound.

#### Reading the spectrum display

- **Teal line/fill:** the measured spectrum of the synthesiser output (before master volume and mute), log frequency
  from 60 Hz to 10 kHz. The comb of peaks is the harmonics of the note; the *envelope* over those peaks is the vocal tract.
- **Gold dashed lines F1-F5:** where the engine is *configured* to put the formants right now (following your finger
  in morph mode). They are targets, not measurements. Peaks in the teal curve should cluster around them, but a formant
  only boosts the harmonics that happen to be nearby, so a marker can sit between two harmonics with no peak.
- **Magenta:** the optional reference recording (below).
- The display refreshes about 30 times a second and stops when the panel closes or the tab is hidden.

#### Reference audio (local)

In the tuner you can choose an audio file you have the right to use and play, pause or stop it next to the synth. It is
decoded in the browser and **never uploaded**. Its spectrum is drawn in magenta over the synth's. Recordings usually include
accompaniment, reverb and compression, and a singer's formants move constantly, so **do not treat every peak as a formant**.
It is a listening and eyeballing aid, not an automatic analyser.

#### Loudness matching

Because a pulse train keeps most of its energy in its fundamental, a note whose pitch lands on a formant is much louder
than its neighbours (measured: up to 5x between adjacent semitones with fixed gains). Each voice therefore predicts its own
output level from its harmonic series through its actual filter bank and scales to a fixed target (`vocal/level.ts`).
Calibrated in Edge against the Square lead: the vocal averaged 1.08x the lead's RMS (about +0.7 dB), with a 1.4x
(about 3 dB) spread across all five vowels and C3-E5. Because of this compensation the resonances can stay fairly narrow (80-270 Hz), which keeps the vowels distinct. あ keeps the wider 150-320 Hz bandwidths it was fitted with.
To re-calibrate, run the dev server, measure `engine.getLevel()` via the dev-only `window.__keytar` hook and adjust
`LEVEL_TARGET`.

#### Matching a reference (how "Miku-inspired (ref fit)" was made)

The default preset was fitted to a 26 s recording of a held あ sung from F3 to F6 (kept locally in `ref/`, which is
git-ignored; the audio is not in this repository). `tools/reference/` repeats the process on any sustained-note clip
(see its README).

The fit is stored as per-vowel tweaks on **あ alone**. The clip is a held あ, so it says nothing about the other vowels,
and an earlier version that applied the fit to every vowel cut F3 for い and え too, which made the front vowels sound like
う and お. What the clip showed, measured with the engine's own offline render so the numbers describe shipping code:

| Measurement | Reference | Bright Vocal (before) | Change in "ref fit" |
|---|---|---|---|
| Vibrato | 3.3 Hz, about ±40 cents, on every note | 5.4 Hz, ±14 cents | 3.3 Hz, ±40 cents (onset delayed 0.45 s) |
| Energy at 2.5-4 kHz | clear dip | about +14 dB too strong | F3 gain 0.15, F4 0.6, F5 0.5 (**on あ only**) |
| Second formant | broad | narrow | bandwidth ×1.49 (**on あ only**) |
| Breath / noise | audible | 0.06 | 0.18 |
| Vowel | あ fits best from F4 up (3.8-9 dB) | - | あ unchanged (F2 scan was flat at ×1.0) |

Result on the notes it was fitted to (F4-C6): harmonic error 7.7 → 5.6 dB, overall distance 10.5 → 7.6 (about 28 % closer).
**It does not improve the extremes:** on held-out notes (A3 and F6) it is no closer than Bright Vocal. The clip's lowest
notes are almost a pure fundamental (much softer than any vowel here), and its last two notes are a different voice
quality (the 2nd harmonic dominates), so a single あ cannot match the whole file. Treat the preset as a starting point to
tune by ear; it is not a clone of any voicebank.

#### Formant synthesis versus a singing voicebank

A commercial voicebank is built from recordings of a real singer, split into phoneme transitions and re-pitched and
joined by a trained engine, which is where the realism of consonants, breaths and phrasing comes from. This engine has none
of that data: it is an original, procedural vowel synthesiser. It can sound convincingly *vowel-like* and *synthetic*,
and it is fully tunable, but it will not sound like a particular singer.

**Currently implemented:** sustained vowel-like timbres, pitch control, continuous vowel morphing, expression controls.
**Not implemented (future):** consonants (fricatives, plosives, nasals), phoneme sequencing, lyric entry, note-to-syllable
alignment, and realistic singing expression (portamento shaping, dynamics, breaths). Vowel morphing alone does **not**
produce intelligible Japanese lyrics. The engine is split so a phoneme sequencer can reuse it: the pure vowel and formant
data are in `vocal/formants.ts` and the voice in `vocal/voice.ts` takes a vowel position and pitch, nothing more.

### Chords

A bar of seven buttons along the bottom plays the **diatonic chords** of the key chosen in Controls → Chords
(key root + major/natural minor, optional 7th chords). Buttons show the roman numeral and chord name, e.g. `V / G`
in C major, `vii° / Bdim`.

- **Rubato:** a chord sounds while its button is held (several can be held at once). Chord voices play under the melody.
- **With rhythm:** tapping a chord selects it and starts the rhythm engine; the chord stays latched (highlighted)
  until you pick another. The ▶/■ Rhythm button in the top bar starts and stops the groove. Stop all also stops it.
- **Melody snapping:** while a chord is sounding or latched, a melody finger that stays still (within 8 px) for the
  configured delay (default 500 ms, 150–2000 ms in Controls) is retuned to the **nearest chord tone**. Moving the finger
  returns to normal scale pitch; releasing a rubato chord un-snaps held notes. Toggle it off with “Snap melody to chord”.
- “Set melody scale to … ” copies the key into the melody root/scale so the two agree.

### Rhythm engine (`src/audio/rhythm.ts`, `patterns.ts`)

A 16-step sequencer (look-ahead scheduling on the AudioContext clock, so timing doesn't depend on UI frames) with four
synthesised layers, each switchable: **drums** (kick, snare, closed/open hat), **bass** (saw + sine through a low-pass,
follows the chord root/fifth), **pad** (detuned saws, sustained or stabbed) and an **arp pluck** (square through a
decaying low-pass, plays chord tones). Bass, pad and arp always follow the active chord; with no chord chosen, only
drums play. Ten patterns, each with a default tempo (adjustable 50–200 BPM) and swing:

1. Pop Rock · 2. Four on the Floor · 3. Pop Ballad · 4. Funk · 5. Reggae One Drop · 6. Hip-Hop · 7. Bossa Nova ·
8. Blues Shuffle · 9. Trap · 10. Synthwave

Patterns are plain 16-character strings in `patterns.ts` (legend at the top of the file), so adding one is a data edit.

### Orientation

Controls → **Orientation** switches the instrument between Landscape and Portrait. Touch devices start in
Landscape even when held upright; desktop starts to match its window. If the screen's shape disagrees with the
chosen orientation, the whole app is laid out at the swapped size and rotated 90° clockwise with CSS (so it works on
iOS, which cannot lock orientation), and pointer coordinates are mapped back into canvas space (`Instrument.setRotated`).
Turn the phone sideways (counter-clockwise) to use it in Landscape. If the OS auto-rotates the page into
a matching shape, no CSS rotation is applied.

### Structure

```
src/audio/pitchmap.ts   scales, x → note snapping (pure functions)
src/audio/presets.ts    preset definitions + brightness → cutoff curve
src/audio/engine.ts     AudioEngine: context, graph, voices (lead or vocal), suspend/resume, spectrum tap
src/audio/voice.ts      VoiceHandle interface shared by every instrument
src/audio/lead.ts       the original keytar lead voice
src/audio/vocal/        formants.ts (vowels, morph), params.ts (bounds, presets), level.ts (loudness), voice.ts
src/audio/reference.ts  local reference-audio player
src/vocalStore.ts       user vocal presets in localStorage
src/audio/chords.ts     diatonic chords, voicings, nearest chord tone (pure)
src/audio/patterns.ts   the ten rhythm patterns (data)
src/audio/rhythm.ts     step sequencer + drum/bass/pad/arp synthesis
src/harmony.ts          chord state shared by chord bar, melody and rhythm
src/interaction.ts      Pointer Events → engine + renderer (no React state per move)
src/visuals/renderer.ts Canvas: grid, trails, glow, pulse (preallocated, rAF loop)
src/components/         PlayingSurface (canvas host), ControlPanel, ChordBar, TunerPanel, SpectrumView
src/App.tsx             state, start/resume overlay, top bar
```

High-frequency input never touches React state: pointer events call the engine and renderer directly, and the
live readout writes to the DOM once per animation frame. The render loop skips drawing when nothing is visible.

## Testing

### Automated (`npm test`, 97 tests)
- Vowel clarity: front vowels carry more upper-formant energy than back vowels; vowel hold maps vowels to themselves,
  is monotonic, and gives flat zones around each vowel; per-vowel tweaks apply fully on their vowel and fade into the
  neighbours; an edit on あ leaves い exactly unchanged; the reference-fitted あ is exactly the fitted values; the fit
  does not touch the other vowels or the global tweaks.
- Vocal formants: five Japanese vowels with ordered, in-range resonances; exact interpolation at every vowel endpoint,
  geometric midpoints, a continuous 400-step sweep with no jumps; clamping of positions and tweaks; filter Q ceiling;
  pitch has no effect on formants when tracking is 0.
- Vocal parameters: three presets within every bound and audibly different; sanitising of NaN, wrong types and
  out-of-range values; pulse-wave spectrum (square = odd harmonics only, 2/(nπ) amplitudes; narrower = brighter);
  vertical-axis mapping in morph and fixed modes; pitch and vowel independence.
- Loudness compensation: finite and positive everywhere, lands on target for every vowel and pitch, scales inversely with
  formant gain, bounded for hostile settings.
- Vocal engine (fake `AudioContext`): voice creation and release stop every source; four independent simultaneous notes;
  Stop All including releasing voices; voice cap; switching lead ⇄ vocal while notes are held leaves nothing orphaned;
  preset/parameter changes on held notes create no extra oscillators; the lead's brightness → cutoff mapping is unchanged.
- Settings and presets: legacy settings load unchanged on the lead; invalid vocal fields fall back; user presets persist,
  are capped, cleaned and sanitised, survive blocked storage, and never touch the built-ins.
- Chord theory: C major / A minor triads, 7th chords, roman numerals, voicings, nearest-chord-tone search.
- Rhythm: all ten patterns are well-formed; each schedules a full bar against a fake clock without errors; stop
  halts scheduling; muted layers add nothing; drums-only when no chord is chosen.
- Scale layouts, edge mapping, snapping only to scale notes, chromatic semitone coverage, note names/frequencies.
- Logarithmic, monotonic brightness → cutoff curve.
- Audio voice lifecycle against a fake `AudioContext`: notes are ignored until audio is running; four simultaneous
  voices released independently leave no active or unstopped oscillators; repeated pointer-down on the same id;
  Stop All including already-releasing voices; voice cap; moving/releasing unknown voices is harmless.

### Verified in a real browser (Edge headless via DevTools protocol, touch emulation, 800×420)
- Start Audio overlay appears, AudioContext reaches `running`, overlay dismisses.
- Four simultaneous touches with independent trails, glow and snapped-note columns; moving fingers while held; releasing.
- Controls panel opens; switching preset while a note is held; live note/brightness/Hz readout.
- No console errors or warnings.
- Vocal engine, measured with the engine's own analyser: the five vowels are spectrally distinct (う/お dark with energy only
  below ~600 Hz, あ open with strong 600-1800 Hz, え/い bright near 2.4/3.4 kHz); a full う→い sweep has no level jumps
  (largest step ≈ 1.5 dB, i.e. meter noise); loudness is within ±1.5 dB across vowels and pitches and ≈ the lead's level.
- Vocal UI: instrument switch, vowel readout, tuner with live spectrum and F1-F5 markers, A/B/C slots, preset save and
  delete with persistence, local reference file load/play/stop.

### Manual checklist (needs a real device / ears: not verifiable headlessly)
- [ ] **Vocal timbre by ear:** do the vowels read as あ い う え お? Is Bright Vocal forward and youthful rather than
      buzzy or nasal-in-a-bad-way? Is Soft smoother, Electronic more synthetic? (All values are starting estimates.)
- [ ] Vowel morph feels smooth under a moving finger, with no zipper noise; chords under a held melody stay clean.
- [ ] Switch Lead ⇄ Vocal while holding notes: nothing sticks; Stop All is immediate.
- [ ] A/B/C loudness feels matched on your speakers and headphones.
- [ ] Spectrum and the tuner stay smooth on a mid-range phone (the display runs at ~30 fps while open).
- [ ] Rhythm engine: all ten patterns sound musical; drum/bass/pad/arp balance and tempo feel right; no clicks when
      changing chords or pattern mid-groove. (Mix levels were set conservatively without listening: tune the
      `LAYER_LEVEL` and per-instrument peaks in `rhythm.ts` by ear.)
- [ ] Chord bar: hold chords with one thumb while playing melody with another; snap delay feels right.
- [ ] Desktop mouse playback; drag across the surface and release outside the window.
- [ ] Single-finger melody on iOS Safari and Android Chrome.
- [ ] Four-finger playback; releasing fingers in different orders.
- [ ] Changing pitch and brightness while holding; confirm no clicks.
- [ ] Switching Pure / Digital / Ethereal while notes are held.
- [ ] Rotate the device (portrait ↔ landscape): mapping stays X = pitch, Y = brightness; panel moves to the side.
- [ ] Background the tab / lock the phone, return: voices stopped, **Resume Audio** button appears and works.
- [ ] Stop All and Mute are immediate.
- [ ] Airplane mode after one online load: the app still opens and plays.

## Known browser limitations

- **iOS silent switch:** Web Audio is muted when the hardware ringer switch is on silent. Turn silent mode off.
- **Autoplay policy:** audio can only start after a tap, hence the Start Audio button. Browsers may suspend the
  context again (backgrounding, calls, Bluetooth changes); use **Resume Audio**.
- **Full screen:** not available for arbitrary pages on iPhone Safari (the button is hidden when unsupported).
  Add the page to the Home Screen for a chrome-free view.
- **Latency:** depends on device and output (Bluetooth headphones add noticeable delay). `latencyHint: "interactive"` is requested.
- **System gestures:** iOS edge-swipe/Control Centre gestures can still cancel a touch near the screen edge; cancelled pointers release their notes cleanly.
- **Offline:** requires the first load over HTTPS (or localhost) so the service worker can install.
- **Vocal engine:** vowels only (no consonants or lyrics), tuned to estimated values rather than measured ones, and
  each vocal voice is roughly 25 audio nodes, so very dense playing (many fingers plus all chord notes) costs more CPU
  than the lead. Reference-file decoding depends on the browser's codecs; very long files are refused above 60 MB.
- **Hardware limits:** many simultaneous touches are capped by the device (commonly 5–10). Use *Reduced visuals* on slow phones.
