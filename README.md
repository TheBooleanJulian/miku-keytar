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
src/audio/engine.ts     AudioEngine: context, graph, voices, suspend/resume
src/interaction.ts      Pointer Events → engine + renderer (no React state per move)
src/visuals/renderer.ts Canvas: grid, trails, glow, pulse (preallocated, rAF loop)
src/components/         PlayingSurface (canvas host), ControlPanel
src/App.tsx             state, start/resume overlay, top bar
```

High-frequency input never touches React state: pointer events call the engine and renderer directly, and the
live readout writes to the DOM once per animation frame. The render loop skips drawing when nothing is visible.

## Testing

### Automated (`npm test`, 13 tests)
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

### Manual checklist (needs a real device / ears: not verifiable headlessly)
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
- **Hardware limits:** many simultaneous touches are capped by the device (commonly 5–10). Use *Reduced visuals* on slow phones.
