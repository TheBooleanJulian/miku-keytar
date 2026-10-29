# Reference analysis and fitting (dev tool)

Measure a recording of sustained notes, then fit the vocal engine's parameters to it. Everything runs locally; the
audio never leaves your machine, and `ref/` is git-ignored so a recording cannot be committed by accident. Only use
recordings you have the right to use.

Requirements (dev only, nothing is added to the app): Node 22, `ffmpeg` on the PATH, Edge or Chrome, and the dev server.

```bash
npm run dev                                          # leave running (http://127.0.0.1:5173)
node tools/reference/analyze.mjs "ref/clip.mp3"      # pitch, steady notes, spectral balance, vibrato  -> ref/.analysis/
node tools/reference/fit.mjs ref/.analysis           # fits the engine to the mid/high notes, prints before/after
```

Environment: `BROWSER_PATH` (default: Edge on Windows), `DEV_URL` (default `http://127.0.0.1:5173/`).

## What it does

- `analyze.mjs` decodes the file (ffmpeg), tracks pitch (YIN), finds steady notes of 1.2 s or more and, for each,
  measures band energy relative to the total, harmonic levels at k x f0, vibrato rate/depth, and a loudness figure.
- `synth.mjs` renders the **real engine** offline in headless Edge (`OfflineAudioContext`), so the numbers describe the
  code that ships, not a model of it.
- `fit.mjs` does coordinate descent over a small set of parameters (pulse width, saw/sine, brightness, breath, tracking,
  F1/F2/F3 frequency, F2 bandwidth, F3-F5 gain) to minimise harmonic and band distance on the notes it is given, and
  reports a **holdout** error on notes it did not fit.

## Reading the results honestly

- A distance in dB is only meaningful relative to another distance on the same recording (e.g. before vs after).
- The fit assumes one vowel. If the recording changes vowel or voice quality part-way (the clip used for the
  built-in "Miku-inspired" preset does), a poor holdout error is expected and tells you the model is out of its depth there.
- The 100-300 Hz band holds room noise and rumble in most recordings; the evaluation scripts exclude it for notes above 300 Hz.
- Recordings usually contain reverb, compression and MP3 loss; do not read every peak as a vowel formant.
- The vibrato estimator was validated against the engine: set 3.3 Hz +-40 cents and it reads back 3.3 Hz +-40 cents.
