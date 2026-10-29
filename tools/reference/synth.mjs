// Renders the real engine offline in headless Edge and returns raw samples to Node for analysis.
import { spawn } from "node:child_process";
import path from "node:path";

const BROWSER = process.env.BROWSER_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEV_URL = process.env.DEV_URL ?? "http://127.0.0.1:5173/";

export async function startSynth(outDir) {
  const edge = spawn(
    BROWSER,
    ["--headless=new", "--remote-debugging-port=9334", "--autoplay-policy=no-user-gesture-required",
     `--user-data-dir=${path.resolve(outDir, `browser-${Date.now()}`)}`, "--no-first-run", "about:blank"],
    { stdio: "ignore" },
  );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9334/json")).json(); if (targets.find((t) => t.type === "page")) break; } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.navigate", { url: DEV_URL });
  await sleep(2500);

  // helper installed in the page once: offline render of one note through the real engine
  await evalJs(`(async () => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    window.__render = async (opts) => {
      const sr = 44100, dur = opts.dur ?? 2.4;
      const off = new OfflineAudioContext(1, Math.round(sr * dur), sr);
      Object.defineProperty(off, 'state', { get: () => 'running' });
      off.resume = async () => {};
      const eng = new AudioEngine(() => off);
      eng.configure({ volume: 1, muted: false, preset: opts.preset ?? 'square', effects: !!opts.effects, modulation: false,
        glide: false, rhythmVolume: 0.7, instrument: opts.instrument ?? 'vocal', vocal: opts.vocal, vocalAxis: opts.axis ?? 'fixed' });
      await eng.init();
      eng.noteOn(1, 69 + 12 * Math.log2(opts.f0 / 440), opts.y ?? 0.5);
      const buf = await off.startRendering();
      const f = buf.getChannelData(0), bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    window.__params = (await import('/src/audio/vocal/params.ts'));
    return true;
  })()`);

  return {
    sr: 44100,
    /** vocal: full VocalParams-shaped object (patch on top of defaults via `patch`) */
    async render(opts) {
      const meta = JSON.stringify({ f0: opts.f0, y: opts.y, axis: opts.axis, dur: opts.dur, effects: opts.effects, instrument: opts.instrument, preset: opts.preset });
      const b64 = await evalJs(`(async () => {
        const P = window.__params;
        const base = ${opts.base ? `P.sanitizeVocal(${JSON.stringify(opts.base)})` : "P.defaultVocal()"};
        const vocal = P.sanitizeVocal(Object.assign({}, base, ${JSON.stringify(opts.patch ?? {})}), base);
        return await window.__render(Object.assign(${meta}, { vocal }));
      })()`);
      const buf = Buffer.from(b64, "base64");
      return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    },
    async params(patch, base) {
      return evalJs(`(() => { const P = window.__params; const b = ${base ? `P.sanitizeVocal(${JSON.stringify(base)})` : "P.defaultVocal()"}; return JSON.stringify(P.sanitizeVocal(Object.assign({}, b, ${JSON.stringify(patch ?? {})}), b)); })()`);
    },
    close() { try { ws.close(); } catch {} edge.kill(); },
  };
}
